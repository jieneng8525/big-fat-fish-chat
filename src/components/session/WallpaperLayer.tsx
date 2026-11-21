import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { loadWallpaperBlob } from '../../services/chat/db.js'
import { setWallpaperBrightness, useSettings } from '../../services/settings.js'
import {
  directoryPermission,
  loadDirectoryHandle,
  readCandidate,
  scanDirectory,
} from '../../services/wallpaperFollow.js'
import styles from './WallpaperLayer.module.css'

/**
 * 采样图片平均亮度，范围 0（纯黑）到 1（纯白）。
 *
 * 用来决定浅色主题下的文字配色与蒙版：
 * - 亮壁纸本身对比度足够，再叠白纱会被洗成一片白
 * - 暗壁纸需要压暗 + 浅色文字，否则深色文字看不清
 * 固定百分比做不到两头都合适，只能按实际像素决定。
 *
 * 采样时缩到 32×32 再取平均，避免 4K 壁纸读全图卡住主线程。
 */
/** 把任意可画的像素源（图片 / 视频帧）缩到 32×32 求平均亮度 */
const averageBrightness = (source: CanvasImageSource): number => {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return 0.5
  }
  ctx.drawImage(source, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)
  let sum = 0
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    // 忽略完全透明的像素
    if (data[i + 3] < 8) {
      continue
    }
    // 感知亮度（Rec.709）
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    count += 1
  }
  return count === 0 ? 0.5 : sum / count / 255
}

const sampleBrightness = (blob: Blob): Promise<number> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    let done = false
    const finish = (value: number) => {
      if (!done) {
        done = true
        URL.revokeObjectURL(url)
        resolve(value)
      }
    }
    img.onload = () => {
      try {
        finish(averageBrightness(img))
      } catch {
        // 跨域图片会污染 canvas，读不到就按中等亮度处理
        finish(0.5)
      }
    }
    img.onerror = () => finish(0.5)
    img.src = url
    setTimeout(() => finish(0.5), 5000)
  })


/** 壁纸夹层：位于主内容之下、聊天气泡之上，不拦截任何交互 */
export const WallpaperLayer = () => {
  const wallpaper = useSettings((state) => state.wallpaper)
  const follow = useSettings((state) => state.wallpaperFollow)
  const followFile = useSettings((state) => state.wallpaperFollowFile)
  const [url, setUrl] = useState<string | null>(null)
  const [kind, setKind] = useState<'image' | 'video' | null>(null)
  /** 壁纸平均亮度从共享设置读取，App 那一层也要用它决定文字明暗 */
  const brightness = useSettings((state) => state.wallpaperBrightness)
  /** 页面上正在播放的壁纸视频；亮度直接从它取帧，不再另开解码器 */
  const videoRef = useRef<HTMLVideoElement>(null)
  /** 已经取过样的视频地址，避免 loop 每次重播都重复计算 */
  const sampledUrl = useRef<string | null>(null)

  /**
   * 从正在播放的壁纸视频里取一帧，算平均亮度。
   *
   * 只在真正播放起来之后调用（绑在 onPlaying / onLoadedData 上），
   * 因为没渲染出画面时拿不到像素。同一地址只取一次，loop 重播不重复计算。
   * 取不到就保持上一次的值，不影响壁纸显示。
   */
  const sampleFromVideoElement = (video: HTMLVideoElement) => {
    if (sampledUrl.current === video.currentSrc || video.readyState < 2) {
      return
    }
    try {
      const value = averageBrightness(video)
      sampledUrl.current = video.currentSrc
      setWallpaperBrightness(value)
    } catch {
      // 编码导致 canvas 被污染时放弃
    }
  }

  // 只跟随壁纸 id 变化重建 object URL；同一个 id 不重复读盘
  const wallpaperId = wallpaper?.id ?? null

  useEffect(() => {
    let revoked = false
    let objectUrl: string | null = null
    const cleanup = () => {
      revoked = true
      setUrl(null)
      setKind(null)
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        objectUrl = null
      }
    }

    void (async () => {
      // 每次换壁纸先清空亮度：视频不取样，若不清会残留上一张图的值
      setWallpaperBrightness(null)
      // 1) 跟随模式优先：从授权目录读文件
      if (follow) {
        const blob = await readFollowedBlob(followFile)
        if (revoked) {
          return
        }
        if (blob) {
          objectUrl = URL.createObjectURL(blob.blob)
          setUrl(objectUrl)
          setKind(blob.kind)
          // 视频的亮度不在这里取：此刻还没播放，拿不到像素。
          // 交给 <video onPlaying> 回调直接抓页面上那个正在播的元素。
          sampledUrl.current = null
          if (blob.kind === 'image') {
            const value = await sampleBrightness(blob.blob)
            if (!revoked) {
              setWallpaperBrightness(value)
            }
          }
          return
        }
        // 跟随失败（未授权、目录里没文件）就回落到手动壁纸，不报错打断
      }

      // 2) 手动导入的壁纸
      if (wallpaperId === null) {
        return
      }
      try {
        const blob = await loadWallpaperBlob()
        if (revoked) {
          return
        }
        if (!blob) {
          // 元信息还在但原件丢了（换了浏览器配置或清过站点数据），当作没有壁纸
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
        setKind(wallpaper?.kind ?? null)
        // 与目录分支一致：视频留给 onPlaying 抓帧，图片在这里取
        sampledUrl.current = null
        if ((wallpaper?.kind ?? null) !== 'video') {
          const value = await sampleBrightness(blob)
          if (!revoked) {
            setWallpaperBrightness(value)
          }
        }
      } catch {
        // 读不到就保持透明，由层的底色兜底
      }
    })()

    return cleanup
  }, [wallpaperId, follow, followFile, wallpaper?.kind])

  // 没有壁纸时仍渲染这一层：frame 不再铺底色，主题背景由这里兜底
  return (
    <div className={styles.layer} aria-hidden="true">
      {url && kind ? (
        kind === 'video' ? (
          <video
            ref={videoRef}
            className={styles.media}
            src={url}
            // 壁纸不该有声音，也不该被系统「减少动效」之外的因素打断
            muted
            loop
            autoPlay
            playsInline
            // Safari 要求内联播放才能自动开始
            preload="auto"
            /*
             * 视频亮度只能在真正播放起来之后才取得到像素，所以绑在播放事件上，
             * 而不是另建一个 video 去解码同一段视频——那会两个解码器抢资源，
             * 静音脱离 DOM 时 play() 还可能被拒，实测拿不到帧。
             */
            onPlaying={(event) => sampleFromVideoElement(event.currentTarget)}
            onLoadedData={(event) => {
              // 兜底：某些情况下 playing 不触发，此时也试着抓一帧
              sampleFromVideoElement(event.currentTarget)
            }}
          />
        ) : (
          <img className={styles.media} src={url} alt="" draggable={false} />
        )
      ) : null}
      {/*
        蒙版按壁纸亮度分两种模式（见 computeScrim / 对应的 CSS 类）：
        - 亮壁纸：白色薄纱 + 深色文字
        - 暗壁纸：黑色压暗 + 浅色文字（深色主题那套配色）
        只靠白纱提亮在暗壁纸上走不通——要达标得压到 60% 以上，壁纸就没了。
      */}
      {url ? (
        <div
          className={clsx(styles.scrim, isDarkWallpaper(brightness) && styles.scrimDark)}
          style={{ opacity: computeScrim(brightness) }}
        />
      ) : null}
    </div>
  )
}

/**
 * 壁纸是否属于「暗」档，需要配浅色文字。
 *
 * 阈值 0.5：亮度低于一半时，深色文字在壁纸上已经无法达到 4.5 的对比度，
 * 必须换成浅色文字 + 压暗遮罩。App 那一层也用这个函数决定文字变量，两处必须一致。
 */
export const isDarkWallpaper = (brightness: number | null): boolean =>
  brightness !== null && brightness < 0.5

/**
 * 蒙版不透明度。
 *
 * 亮壁纸（浅色主题）：只需要很薄的白纱保住对比度，几乎保留壁纸原色。
 * 暗壁纸：改用黑色压暗，配浅色文字。实测 rgb(75,65,80) 的壁纸
 *   压暗 20% 后浅色次要文字对比度即达 7.49（要求 4.5）；
 *   而走白纱路线要 60% 以上才勉强达标，壁纸已经被洗没了。
 */
const computeScrim = (brightness: number | null): number => {
  const b = brightness ?? 0.5
  if (isDarkWallpaper(b)) {
    // 暗壁纸：压暗幅度随暗度增加，但不必太深——浅色文字本身对比度就够
    const darkness = 1 - b / 0.5 // 0 在阈值处，1 在纯黑
    return 0.1 + darkness * 0.25 // 10% ~ 35%
  }
  // 亮壁纸：保留壁纸原色，只加极少白纱
  return 0.06
}

/**
 * 从已授权的目录读取当前选中的壁纸。
 *
 * 这是「目录选择」而非「自动跟随」：只显示用户在下拉里明确选中的那个文件。
 * 不再按修改时间兜底——Wallpaper Engine 切换壁纸时不更新时间戳，
 * 兜底只会永远显示同一个文件，反而让用户以为选错了。
 * 权限不是 granted 时直接放弃（requestPermission 需要用户手势，不能在渲染里调用）。
 */
const readFollowedBlob = async (
  followFile: string | null
): Promise<{ blob: Blob; kind: 'image' | 'video' } | null> => {
  // 没选过具体文件就不显示，由设置界面引导选择
  if (!followFile) {
    return null
  }
  try {
    const handle = await loadDirectoryHandle()
    if (!handle) {
      return null
    }
    const permission = await directoryPermission(handle)
    if (permission !== 'granted') {
      return null
    }
    const candidates = await scanDirectory(handle)
    const picked = candidates.find((item) => item.name === followFile)
    if (!picked) {
      return null
    }
    const blob = await readCandidate(picked)
    return { blob, kind: picked.kind }
  } catch {
    return null
  }
}
