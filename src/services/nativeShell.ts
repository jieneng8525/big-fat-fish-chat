/**
 * 原生（Capacitor）环境下与系统交互的桥接。
 *
 * 网页端和 App 端有两处行为必须分开，因为 WebView 缺能力：
 *
 * 1. 打开 HTML 代码块
 *    网页端 window.open(blobUrl) 开新标签页，返回时原页面还在。
 *    App 里 window.open 会让系统接管成新窗口；用户按返回键或左右滑动，
 *    直接把整个 App 退掉（实测确认）。
 *    这里改成：写临时文件 → FileProvider 转 content:// → 拉起系统分享/打开面板，
 *    由用户选「用浏览器打开」，跳出去以后按返回就回到 App，不会退出。
 *
 * 2. 下载文件
 *    网页端用 <a download> 触发浏览器下载。
 *    App 里这个属性没人接管，表现为「跳到下载页但没下载」（WebView 没有
 *    DownloadListener）。改用 Filesystem 写进公有文档目录，再弹分享面板。
 *
 * 所有能力都只在 isNativePlatform() 为 true 时启用，网页端逻辑一行不改。
 */

import { Capacitor } from '@capacitor/core'

/** 是否运行在 Capacitor 原生壳里 */
export const isNative = (): boolean => Capacitor.isNativePlatform()

/** 下载与临时文件统一放在这个子目录下，方便用户找 */
const APP_DIR = '大肥鱼Chat'

/** 纯文本类 MIME：写入时走 UTF-8 字符串而非 base64 */
const isTextMime = (mime: string): boolean =>
  mime.startsWith('text/') || mime === 'application/json' || mime === ''

/** Blob → base64（分块，避免 String.fromCharCode 参数过多爆栈） */
const blobToBase64 = async (blob: Blob): Promise<string> => {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export type SaveResult =
  | { ok: true; path: string; shared: boolean }
  | { ok: false; reason: string }

/**
 * 保存文件到 App 的外部文档目录，并拉起分享面板（可存网盘、发微信、用其他 App 打开）。
 *
 * ⚠ 这里**不能**用 Directory.Documents。
 *
 * Documents 映射到公共的 /storage/emulated/0/Documents。从 Android 11 起，
 * 公共目录下应用只能写自己（通过 MediaStore）创建的文件；直接 open() 一个路径
 * 会拿到 EACCES (Permission denied)。真机实测报错：
 *     'writeFile' failed with: /storage/emulated/0/Documents/大肥鱼Chat/x.html:
 *     open failed: EACCES (Permission denied)
 *
 * 我在模拟器上测试时"通过"了，是因为那个目录恰好由 adb 以 App 的 uid 创建，
 * 属主和 App 一致，所以写得进去。这个前提在真机上不成立 —— 这是我判断失误，
 * 不是模拟器的问题。
 *
 * 改用 Directory.External：
 *   → /storage/emulated/0/Android/data/<package>/files/大肥鱼Chat/
 * 这是 App 自己的外部目录，**无需任何存储权限**，卸载时才删除。
 * 路径虽然在 Android/data 下，但分享面板会把它以 content:// 暴露出去，
 * 用户能正常存到网盘/相册/其他 App，体验不受影响。
 *
 * 分享面板当前是否开着 —— Share.share() 会一直挂起到用户做出选择；
 * 这期间再调用一次，Android 会抛 "Can't share while sharing is in progress"。
 * 实测确认过这个报错，而且它会被上层当成「保存失败」，提示就成了误导。
 * 所以用一个模块级标志挡住重入：面板开着时直接返回，不重复弹。
 */
let shareInFlight = false

export const saveToDownloads = async (blob: Blob, fileName: string): Promise<SaveResult> => {
  if (!isNative()) {
    return { ok: false, reason: 'not-native' }
  }
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')

    const text = isTextMime(blob.type)
    const data = text ? await blob.text() : await blobToBase64(blob)
    const relPath = `${APP_DIR}/${fileName}`

    const written = await Filesystem.writeFile({
      path: relPath,
      data,
      directory: Directory.External,
      encoding: text ? Encoding.UTF8 : undefined,
      recursive: true,
    })

    /*
     * 分享必须走自写的 ShareFile 插件，不能用 @capacitor/share。
     *
     * writeFile 返回的是 file:///storage/emulated/0/Android/data/... ，
     * 这种 URI 跨进程没有读权限。Share 插件把它原样放进 Intent，
     * 接收方拿到的就是空壳 —— 实测从文件管理器另存出来的文件只有 16 字节，
     * 扩展名还退化成 .txt。
     *
     * ShareFile 用 FileProvider 换成 content:// 并带上
     * FLAG_GRANT_READ_URI_PERMISSION，接收方才能真正读到 6251 字节的原文。
     */
    if (shareInFlight) {
      return { ok: true, path: written.uri, shared: false }
    }
    const plugin = (
      Capacitor as unknown as {
        Plugins?: {
          ShareFile?: {
            share: (o: { path: string; mime: string; title: string }) => Promise<unknown>
          }
        }
      }
    ).Plugins?.ShareFile
    if (!plugin) {
      // 没有自定义插件（例如旧包）时不弹面板，文件已经落盘，不算失败
      return { ok: true, path: written.uri, shared: false }
    }
    shareInFlight = true
    let shared = false
    try {
      await plugin.share({ path: relPath, mime: blob.type || 'application/octet-stream', title: fileName })
      shared = true
    } catch {
      // 用户取消分享不算失败，文件已经落盘
      shared = false
    } finally {
      shareInFlight = false
    }
    return { ok: true, path: written.uri, shared }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 用「系统浏览器」打开一段 HTML。
 *
 * 走自定义原生插件 OpenInBrowserPlugin：
 * 把 HTML 写进 App 缓存目录 → FileProvider 转 content:// → Intent.ACTION_VIEW。
 * 打开的是独立浏览器进程，用户按返回回到大肥鱼Chat，不会退出。
 *
 * 三条 Web 层方案都实测失败，别再试：
 * - window.open(blobUrl)：系统接管成内嵌窗口，按返回直接退出 App
 * - Browser.open('data:text/html')：CustomTabs 拒绝，报 "Unable to display URL"
 * - location.href = blobUrl：不生成历史记录，返回同样退出
 *
 * 返回 true 表示已交给系统；false 表示非原生环境或失败，调用方回退 window.open。
 */
export const openHtmlNatively = async (html: string, fileName: string): Promise<boolean> => {
  if (!isNative()) {
    return false
  }
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    // 写在 cache 目录：file_paths.xml 已声明 cache-path，FileProvider 能取到
    const path = `preview/${fileName}`
    await Filesystem.writeFile({
      path,
      data: html,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    })

    const plugin = (
      Capacitor as unknown as {
        Plugins?: { OpenInBrowser?: { open: (o: { path: string; mime: string }) => Promise<unknown> } }
      }
    ).Plugins?.OpenInBrowser
    if (!plugin) {
      return false
    }
    await plugin.open({ path, mime: 'text/html' })
    return true
  } catch {
    return false
  }
}
