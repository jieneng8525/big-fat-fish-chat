/**
 * 壁纸：支持图片与视频作为聊天背景。
 *
 * 浏览器原生解码能力差异很大，导入前先实测「能不能画出来」，而不是只看扩展名：
 * - png / jpeg / jpg / webp / gif / svg：主流浏览器原生支持，直接可用
 * - mp4 / webm：取决于编码，H.264 的 mp4 与 VP8/VP9/AV1 的 webm 可用
 * - mov / mkv：只能靠容器里的编码判断，H.264 可播、H.265(HEVC) 多数浏览器不行
 * - heic：除 Safari 17+ 外浏览器都不解码 HEVC 编码的 HEIC（专利原因），需要 WASM 兜底
 * - tiff：没有浏览器能直接显示，本实现不支持
 *
 * 因此导入流程是「先检测、后落盘」：检测不通过直接拒绝并给出原因，避免存进去却显示不出来。
 */

/** 壁纸来源：图片或视频 */
export type WallpaperKind = 'image' | 'video'

/** 一条壁纸记录，原件存 IndexedDB，设置里只引用 id */
export type Wallpaper = {
  id: string
  kind: WallpaperKind
  name: string
  mimeType: string
  size: number
}

/** 导入失败的已知原因；文案在 i18n 里，便于中英文各写各的 */
export type WallpaperError =
  /** 扩展名不在支持范围 */
  | 'unsupported-format'
  /** 格式受支持，但浏览器解不开（多为 HEVC 编码的 mov/mkv，或非 Safari 的 heic） */
  | 'undecodable'
  /** 文件读取失败 */
  | 'read-failed'
  /** 超过单文件大小上限 */
  | 'too-large'

/** 单文件上限。壁纸要常驻内存，视频尤其吃解码器和显存。 */
export const WALLPAPER_MAX_BYTES = 100 * 1024 * 1024

const IMAGE_EXTS = ['png', 'jpeg', 'jpg', 'webp', 'gif', 'svg'] as const
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv'] as const
/** 明确不支持，用于给出准确的拒绝原因而不是笼统的「不支持」 */
const KNOWN_UNSUPPORTED = ['heic', 'heif', 'tiff', 'tif', 'bmp', 'avif'] as const

export const wallpaperExt = (name: string): string =>
  name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''

/** 按扩展名归类；返回 null 表示不接受这个扩展名 */
export const wallpaperKindOf = (name: string): WallpaperKind | null => {
  const ext = wallpaperExt(name)
  if ((IMAGE_EXTS as readonly string[]).includes(ext)) {
    return 'image'
  }
  if ((VIDEO_EXTS as readonly string[]).includes(ext)) {
    return 'video'
  }
  return null
}

export const isKnownUnsupported = (name: string): boolean =>
  (KNOWN_UNSUPPORTED as readonly string[]).includes(wallpaperExt(name))

/** 读取文件头部判断真实类型，不信任扩展名 */
export const sniffKind = async (blob: Blob): Promise<WallpaperKind | null> => {
  if (blob.type.startsWith('image/')) {
    return 'image'
  }
  if (blob.type.startsWith('video/')) {
    return 'video'
  }
  const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer())
  // PNG
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image'
  }
  // JPEG
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image'
  }
  // GIF / WEBP（RIFF....WEBP）
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) {
    return 'image'
  }
  if (
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return 'image'
  }
  // ISO-BMFF（mp4 / mov / heic / avif 共用），看 ftyp 品牌
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
    const brand = String.fromCharCode(head[8], head[9], head[10], head[11]).toLowerCase()
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1')) {
      return 'image'
    }
    if (brand.startsWith('avif')) {
      return 'image'
    }
    return 'video'
  }
  // Matroska / WebM（0x1A45DFA3）
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return 'video'
  }
  return null
}

/** 图片：交给浏览器实际解码一次，能画到 canvas 上才算通过 */
const canDecodeImage = (blob: Blob): Promise<boolean> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    let done = false
    const finish = (ok: boolean) => {
      if (!done) {
        done = true
        URL.revokeObjectURL(url)
        resolve(ok)
      }
    }
    img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0)
    img.onerror = () => finish(false)
    img.src = url
    // SVG 这类同步就绪的，兜底超时
    setTimeout(() => finish(img.complete && img.naturalWidth > 0), 4000)
  })

/** 视频：等元数据加载，能拿到时长或尺寸才算通过 */
const canDecodeVideo = (blob: Blob): Promise<boolean> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    let done = false
    const finish = (ok: boolean) => {
      if (!done) {
        done = true
        video.removeAttribute('src')
        video.load()
        URL.revokeObjectURL(url)
        resolve(ok)
      }
    }
    video.muted = true
    video.preload = 'metadata'
    video.onloadedmetadata = () =>
      finish(Number.isFinite(video.duration) && video.videoWidth > 0)
    video.onerror = () => finish(false)
    video.src = url
    setTimeout(() => finish(false), 8000)
  })

/**
 * 校验并返回可用的壁纸类型。
 * 外层先按扩展名拒绝明显不支持的格式，再实测解码能力——扩展名是白名单，解码才是硬门槛。
 */
export const validateWallpaper = async (
  file: Blob & { name: string }
): Promise<{ ok: true; kind: WallpaperKind } | { ok: false; error: WallpaperError }> => {
  if (file.size > WALLPAPER_MAX_BYTES) {
    return { ok: false, error: 'too-large' }
  }
  if (isKnownUnsupported(file.name) || wallpaperKindOf(file.name) === null) {
    return { ok: false, error: 'unsupported-format' }
  }
  const kind = await sniffKind(file)
  if (kind === null) {
    return { ok: false, error: 'unsupported-format' }
  }
  const ok = kind === 'image' ? await canDecodeImage(file) : await canDecodeVideo(file)
  return ok ? { ok: true, kind } : { ok: false, error: 'undecodable' }
}
