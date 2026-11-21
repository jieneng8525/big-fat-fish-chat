import { useEffect, useRef, useState } from 'react'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { useSettings } from '../../services/settings.js'
import {
  saveWallpaperBlob,
  clearWallpaperBlob,
} from '../../services/chat/db.js'
import {
  setWallpaper,
  setWallpaperFollow,
  setWallpaperFollowFile,
} from '../../services/settings.js'
import { validateWallpaper, WALLPAPER_MAX_BYTES } from '../../services/wallpaper.js'
import {
  clearDirectoryHandle,
  directoryPermission,
  loadDirectoryHandle,
  pickWallpaperDirectory,
  requestDirectoryPermission,
  saveDirectoryHandle,
  scanDirectory,
  supportsDirectoryFollow,
  type DirectoryCandidate,
} from '../../services/wallpaperFollow.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** 导入失败原因 → 文案 key */
const errorKey: Record<string, TranslationKey> = {
  'unsupported-format': 'wallpaperErrorFormat',
  undecodable: 'wallpaperErrorDecode',
  'read-failed': 'wallpaperErrorRead',
  'too-large': 'wallpaperErrorTooLarge',
}

/** 壁纸设置：手动导入 + 从授权目录选择（仅 Chromium 系可用） */
export const WallpaperSetting = () => {
  const t = useTranslate()
  const wallpaper = useSettings((state) => state.wallpaper)
  const follow = useSettings((state) => state.wallpaperFollow)
  const followFile = useSettings((state) => state.wallpaperFollowFile)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<DirectoryCandidate[]>([])
  const canFollow = supportsDirectoryFollow()

  /**
   * 组件每次挂载（打开设置）时重新扫描已授权的目录。
   *
   * candidates 只存在组件 state 里，关闭设置弹窗就没了；
   * 不重扫的话，已接入目录的用户再次打开设置会看不到下拉框。
   * 权限已是 granted 时扫描不需要用户手势，可以直接在 effect 里做。
   */
  useEffect(() => {
    if (!follow || !canFollow) {
      setCandidates([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const handle = await loadDirectoryHandle()
        if (!handle || (await directoryPermission(handle)) !== 'granted') {
          return
        }
        const list = await scanDirectory(handle)
        if (!cancelled) {
          setCandidates(list)
        }
      } catch {
        // 扫描失败就保持空列表，用户仍可重新接入目录
      }
    })()
    return () => {
      cancelled = true
    }
  }, [follow, canFollow])

  const onPick = async (file: File) => {
    setBusy(true)
    try {
      const result = await validateWallpaper(file)
      if (!result.ok) {
        showToast({ key: errorKey[result.error] ?? 'wallpaperErrorRead', type: 'error' })
        return
      }
      await saveWallpaperBlob(file)
      setWallpaper({
        id: crypto.randomUUID(),
        kind: result.kind,
        name: file.name,
        mimeType: file.type,
        size: file.size,
      })
      showToast({ key: 'wallpaperApplied' })
    } catch {
      showToast({ key: 'wallpaperErrorRead', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async () => {
    setBusy(true)
    try {
      await clearWallpaperBlob()
      setWallpaper(null)
    } catch {
      showToast({ key: 'wallpaperErrorRead', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  /**
   * 接入壁纸目录：必须在点击事件里调用 showDirectoryPicker / requestPermission，
   * 否则浏览器会以缺少 user activation 为由拒绝。
   *
   * 注意这不是「自动跟随」：接入后由用户在下拉里挑，
   * 所以这里不清空已有选择，也不默认选中第一个文件。
   */
  const onFollow = async () => {
    setBusy(true)
    try {
      // 已有句柄时先尝试恢复权限，省去重新选目录
      const existing = await loadDirectoryHandle()
      if (existing && (await directoryPermission(existing)) === 'denied') {
        await clearDirectoryHandle()
      }
      let handle = existing && (await directoryPermission(existing)) === 'granted' ? existing : null
      if (handle) {
        const granted = await requestDirectoryPermission(handle)
        if (!granted) {
          handle = null
        }
      }
      if (!handle) {
        handle = await pickWallpaperDirectory()
        if (!handle) {
          return
        }
        await saveDirectoryHandle(handle)
      }
      const list = await scanDirectory(handle)
      if (list.length === 0) {
        showToast({ key: 'wallpaperFollowEmpty', type: 'error' })
        return
      }
      setCandidates(list)
      setWallpaperFollow(true)
      // 没选过任何文件时留空，等用户在下拉里挑；选过的保留，避免打断
      if (!followFile || !list.some((item) => item.name === followFile)) {
        setWallpaperFollowFile(null)
      }
      showToast({ key: 'wallpaperFollowOn', params: { count: list.length } })
    } catch {
      showToast({ key: 'wallpaperFollowFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const onFollowOff = async () => {
    setWallpaperFollow(false)
    setCandidates([])
    await clearDirectoryHandle()
  }

  const maxMb = Math.round(WALLPAPER_MAX_BYTES / (1024 * 1024))
  return (
    <div className={styles.cell}>
      <div className={styles.row}>
        <div className={styles.text}>
          <div className={styles.label}>{t('settingWallpaper')}</div>
          <div className={styles.description}>
            {follow
              ? t('settingWallpaperFollowing', { name: followFile ?? '' })
              : wallpaper
                ? t('settingWallpaperCurrent', { name: wallpaper.name })
                : t('settingWallpaperDescription', { max: maxMb })}
          </div>
        </div>
        <div className={styles.wallpaperActions}>
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? t('wallpaperProcessing') : t('wallpaperChoose')}
          </Button>
          {wallpaper ? (
            <Button
              variant="dangerOutlined"
              size="m"
              className={styles.cellButton}
              disabled={busy}
              onClick={() => void onRemove()}
            >
              {t('wallpaperRemove')}
            </Button>
          ) : null}
        </div>
      </div>

      {/*
        视频壁纸 + 浅色主题的强烈警告。

        为什么只对视频提示：图片壁纸能正常读到像素，蒙版浓度是按实际亮度算的；
        而 Android WebView 对硬件解码的视频帧 getImageData 会抛 SecurityError，
        亮度恒为 null，只能退回到固定的 45% 白纱兜底——壁纸会被明显洗白。

        为什么不干脆自动切深色配色：那会连侧边栏、输入框一起变深，
        用户选了浅色主题却得到深色界面，是用一个问题换另一个（已经踩过）。
      */}
      {wallpaper?.kind === 'video' ? (
        <div className={styles.wallpaperWarn} role="note">
          <div className={styles.wallpaperWarnTitle}>{t('wallpaperVideoWarnTitle')}</div>
          <div className={styles.wallpaperWarnBody}>{t('wallpaperVideoWarnBody')}</div>
        </div>
      ) : null}

      {/*
        跟随桌面壁纸：只有支持 File System Access API 的浏览器才显示。
        不支持时整个入口隐藏，避免出现点了没反应的按钮（见 docs/desktop-wallpaper-note.md）。
      */}
      {canFollow ? (
        <div className={styles.row}>
          <div className={styles.text}>
            <div className={styles.label}>{t('wallpaperFollowLabel')}</div>
            <div className={styles.description}>{t('wallpaperFollowDescription')}</div>
          </div>
          <div className={styles.wallpaperActions}>
            {follow ? (
              <Button
                variant="dangerOutlined"
                size="m"
                className={styles.cellButton}
                disabled={busy}
                onClick={() => void onFollowOff()}
              >
                {t('wallpaperFollowDisable')}
              </Button>
            ) : (
              <Button
                variant="outlined"
                size="m"
                className={styles.cellButton}
                disabled={busy}
                onClick={() => void onFollow()}
              >
                {busy ? t('wallpaperProcessing') : t('wallpaperFollowEnable')}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {/* 接入目录后即可从下拉里挑壁纸；未选时显示占位项，不自动挑一个 */}
      {follow && candidates.length > 0 ? (
        <div className={styles.row}>
          <div className={styles.text}>
            <div className={styles.label}>{t('wallpaperFollowPick')}</div>
            <div className={styles.description}>
              {t('wallpaperFollowPickHint', { count: candidates.length })}
            </div>
          </div>
          <select
            className={styles.wallpaperSelect}
            value={followFile ?? ''}
            onChange={(event) => setWallpaperFollowFile(event.target.value || null)}
          >
            <option value="">{t('wallpaperFollowNone')}</option>
            {candidates.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}（{Math.round(item.size / 1024 / 1024)}MB）
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime,.mkv"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) {
            void onPick(file)
          }
        }}
      />
    </div>
  )
}
