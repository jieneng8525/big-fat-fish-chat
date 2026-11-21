import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 配置。
 *
 * 安卓端加载界面的地址必须是「安卓专用」的，不能和 PC 网页端、移动网页端共用同一份。
 *
 * 为什么不共用：
 * 1. Capacitor 的原生插件只注入给 App 自己的源。远程页面里
 *    window.Capacitor.isNativePlatform() 仍返回 true（它判断设备，不判断页面），
 *    于是 src/services/export.ts 与 nativeShell.ts 会走进原生分支，而插件不可用 ——
 *    下载、分享、用浏览器打开 HTML 全部失效，且无报错无提示。
 * 2. 本项目所有安卓修复都依赖原生侧：edge-to-edge 安全区、FileProvider 分享、
 *    存储权限、预览配色。
 * 3. 网页版与 App 端能力集不同。supportsDirectoryFollow() 在 App 里主动隐藏
 *    「跟随目录」入口；远程页面如果是通用那份，会把这个不可用的按钮又渲染出来。
 *
 * 规则：
 * - 不设 APP_SERVER_URL              → 用内置 dist（打进 APK，离线可用）
 * - 设了且路径含 /android           → 加载该地址（应为专门给安卓构建的那份）
 * - 设了但路径不含 /android         → **直接抛错，拒绝构建**
 *
 * 最后一条是关键：宁可构建失败，也不能「悄悄用通用网页版打包」。
 * 那种失败在 App 里表现为功能点了没反应，极难排查。
 */

/** 远程地址必须落在安卓专用路径下 */
const ANDROID_PATH_MARKER = '/android'

const raw = (process.env.APP_SERVER_URL ?? '').trim()

if (raw) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      `APP_SERVER_URL 不是合法地址：${raw}\n` +
        '应为形如 https://your-site.example/android/ 的绝对 URL。'
    )
  }
  if (url.protocol !== 'https:') {
    throw new Error(
      `APP_SERVER_URL 必须是 https（当前：${url.protocol}）。\n` +
        '明文回退是主动关闭的，避免界面被中间人替换。'
    )
  }
  if (!url.pathname.replace(/\/+$/, '').includes(ANDROID_PATH_MARKER)) {
    throw new Error(
      `APP_SERVER_URL 必须指向安卓专用路径，当前是：${url.pathname}\n\n` +
        '原因：安卓端依赖 Capacitor 原生插件（下载、分享、用浏览器打开 HTML、\n' +
        '安全区、FileProvider）。通用网页版那份没有配套的安卓侧假设，\n' +
        '直接拿来用会让这些功能静默失效——不报错，只是点了没反应。\n\n' +
        '正确做法：给安卓单独构建一份，部署在 /android/ 路径下，例如\n' +
        '  https://your-site.example/android/'
    )
  }
}

const config: CapacitorConfig = {
  appId: 'chat.bigfatfish.app',
  appName: '大肥鱼Chat',
  webDir: 'dist',
  ...(raw
    ? {
        server: {
          url: raw,
          cleartext: false,
        },
      }
    : {}),
  android: {
    // WebView 里 localStorage / IndexedDB 的持久化由系统负责，默认即可
    allowMixedContent: false,
  },
}

export default config
