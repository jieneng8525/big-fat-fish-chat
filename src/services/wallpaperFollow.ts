/**
 * 跟随桌面壁纸：读取用户授权目录里的壁纸文件。
 *
 * 原理与边界（详见 docs/desktop-wallpaper-note.md）：
 * - 浏览器读不到注册表，也截不到桌面合成层，所以"实时桌面壁纸"无从获取；
 * - 可行的做法是让用户授权一个目录，程序从里面按文件类型挑出壁纸源文件；
 * - 用 File System Access API（仅 Chromium 系支持），句柄存 IndexedDB，
 *   下次打开时 queryPermission 若已授权即可直接读，无需再点。
 *
 * 重要限制：目录里文件很多时无法知道"当前正在显示的是哪一张"，
 * 只能给出候选列表让用户挑，或按修改时间猜。这是平台能力的上限，不是实现缺陷。
 */

import { openDB } from 'idb'

/** 判断当前浏览器是否具备目录授权能力；不具备时调用方应隐藏整个入口 */export const supportsDirectoryFollow = (): boolean =>
  typeof window !== 'undefined' && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

/** 目录授权状态下可选的壁纸文件 */
export type DirectoryCandidate = {
  name: string
  kind: 'image' | 'video'
  size: number
  lastModified: number
  /** FileSystemFileHandle 不能序列化进设置，只在运行时持有 */
  handle: FileSystemFileHandle
}

/** 单个候选文件上限：与手动导入一致，避免视频过大拖垮背景播放 */
export const FOLLOW_MAX_BYTES = 100 * 1024 * 1024

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] as const
const VIDEO_EXT = ['mp4', 'webm'] as const

/**
 * 壁纸软件的附属文件，不是壁纸本身。
 * Wallpaper Engine 每个壁纸目录里几乎都有 preview.jpg / preview.gif 作为封面缩略图，
 * 它们往往比实际壁纸文件更新，按修改时间排序会被优先选中，显示出来就是一张缩略图。
 */
const PREVIEW_NAME = /^(preview|thumbnail|thumb|cover|icon)\.(jpg|jpeg|png|gif|webp)$/i

const isPreviewFile = (name: string): boolean => PREVIEW_NAME.test(name)

const kindOfName = (name: string): 'image' | 'video' | null => {
  const dot = name.lastIndexOf('.')
  if (dot < 0) {
    return null
  }
  const base = name.slice(Math.max(name.lastIndexOf('/') + 1, 0))
  if (isPreviewFile(base)) {
    return null
  }
  const ext = name.slice(dot + 1).toLowerCase()
  if ((IMAGE_EXT as readonly string[]).includes(ext)) {
    return 'image'
  }
  if ((VIDEO_EXT as readonly string[]).includes(ext)) {
    return 'video'
  }
  return null
}

/** showDirectoryPicker 的类型在 lib.dom 里可能缺失，这里自己声明最小接口 */
type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: string
  }) => Promise<FileSystemDirectoryHandle>
}

/**
 * 让用户选一个目录并返回句柄。
 * 必须在用户点击事件里调用，否则浏览器会拒绝（要求 user activation）。
 */
export const pickWallpaperDirectory = async (): Promise<FileSystemDirectoryHandle | null> => {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker) {
    return null
  }
  try {
    return await picker({ id: 'wallpaper-dir', mode: 'read' })
  } catch {
    // 用户取消选择也是异常，这里静默返回
    return null
  }
}

/** 句柄在 IndexedDB 里能否直接存：Chrome 支持结构化克隆 FileSystemHandle */
const HANDLE_KEY = 'wallpaper-dir-handle'

/** 独立的小库，不和会话数据混在一起，避免影响 chat-demo 主库的版本迁移 */
const handleStore = async () =>
  openDB<{ handles: { key: string; value: unknown } }>('chat-demo-wallpaper-handles', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles')
      }
    },
  })

export const saveDirectoryHandle = async (handle: FileSystemDirectoryHandle): Promise<void> => {
  const db = await handleStore()
  await db.put('handles', handle, HANDLE_KEY)
}

export const loadDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const db = await handleStore()
    const value = await db.get('handles', HANDLE_KEY)
    return (value as FileSystemDirectoryHandle | undefined) ?? null
  } catch {
    return null
  }
}

export const clearDirectoryHandle = async (): Promise<void> => {
  try {
    const db = await handleStore()
    await db.delete('handles', HANDLE_KEY)
  } catch {
    // 存储不可用时忽略
  }
}

/** 权限状态：granted 可直接读；prompt 需要一次用户点击；denied 被拒绝 */
export const directoryPermission = async (
  handle: FileSystemDirectoryHandle
): Promise<'granted' | 'prompt' | 'denied'> => {
  const query = (handle as unknown as { queryPermission?: (descriptor: { mode: string }) => Promise<string> })
    .queryPermission
  if (!query) {
    return 'prompt'
  }
  const state = await query.call(handle, { mode: 'read' })
  return state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt'
}

/** 需要用户点击才能恢复权限；不在点击事件里调用会抛 SecurityError */
export const requestDirectoryPermission = async (
  handle: FileSystemDirectoryHandle
): Promise<boolean> => {
  const request = (handle as unknown as { requestPermission?: (descriptor: { mode: string }) => Promise<string> })
    .requestPermission
  if (!request) {
    return false
  }
  try {
    return (await request.call(handle, { mode: 'read' })) === 'granted'
  } catch {
    return false
  }
}

/** 递归深度上限：壁纸工坊是「根/壁纸ID/文件」，3 层足够，再深多半是无关资源 */
const MAX_DEPTH = 3
/** 目录项访问总量上限，防止超大目录把界面拖死 */
const MAX_VISITS = 3000
/** 候选数量上限，避免一次列出几百个把选择框撑爆 */
const MAX_CANDIDATES = 200

/**
 * 扫描目录里的壁纸候选（递归）。
 *
 * 必须递归：Steam 创意工坊的结构是「431960/<壁纸ID>/文件」，
 * 根目录下没有任何文件，只扫一层必然为空。
 *
 * 实测 121 个壁纸目录、205 个文件Recursive 扫描耗时约 276ms，不会卡顿；
 * 仍保留深度与总量上限，防止用户误选超大目录时卡死。
 */
export const scanDirectory = async (
  handle: FileSystemDirectoryHandle
): Promise<DirectoryCandidate[]> => {
  const candidates: DirectoryCandidate[] = []
  let visits = 0

  /** 深度优先遍历；路径前缀用来在同名文件之间区分来源 */
  const walk = async (dir: FileSystemDirectoryHandle, depth: number, prefix: string) => {
    if (depth > MAX_DEPTH || visits >= MAX_VISITS || candidates.length >= MAX_CANDIDATES) {
      return
    }
    const entries = dir as unknown as AsyncIterable<[string, FileSystemHandle]>
    for await (const [name, entry] of entries) {
      visits += 1
      if (visits >= MAX_VISITS || candidates.length >= MAX_CANDIDATES) {
        return
      }
      if (entry.kind === 'directory') {
        await walk(entry as FileSystemDirectoryHandle, depth + 1, `${prefix}${name}/`)
        continue
      }
      const kind = kindOfName(name)
      if (!kind) {
        continue
      }
      const fileHandle = entry as FileSystemFileHandle
      try {
        const file = await fileHandle.getFile()
        if (file.size > FOLLOW_MAX_BYTES || file.size === 0) {
          continue
        }
        candidates.push({
          // 同名文件在不同壁纸目录里很常见，带上相对路径才能区分
          name: `${prefix}${name}`,
          kind,
          size: file.size,
          lastModified: file.lastModified,
          handle: fileHandle,
        })
      } catch {
        // 个别文件读不到就跳过，不影响其他候选
      }
    }
  }

  await walk(handle, 0, '')
  // 最近修改的排在前面：壁纸软件通常最后写入当前壁纸
  return candidates.sort((a, b) => b.lastModified - a.lastModified)
}

/** 从候选里读出一个 Blob，供壁纸层显示 */
export const readCandidate = async (candidate: DirectoryCandidate): Promise<Blob> =>
  candidate.handle.getFile()
