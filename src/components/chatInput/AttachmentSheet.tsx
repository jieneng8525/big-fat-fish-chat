import { useEffect, useRef } from 'react'
import {
  IconCameraOutline24,
  IconFileOutline24,
  IconGalleryOutline24,
} from '../base/icons.js'
import { isNative } from '../../services/nativeShell.js'
import { useTranslate } from '../../i18n/index.js'
import { ACCEPT } from '../../services/attachments.js'
import styles from './AttachmentSheet.module.css'

/**
 * 输入框下方的附件面板：拍照 / 相册 / 文件。
 *
 * 为什么需要它：
 *   原来点回形针直接 <input type="file"> 不带 accept，Android 会弹出
 *   文件管理器 —— 找图片得在目录树里翻，非常难用。
 *   官方 App 的做法是点「+」在输入框下方升起一排入口，点到「相册」
 *   才进系统图库。
 *
 * 三个入口对应三个独立的 <input>，靠 accept / capture 区分：
 *
 *   拍照  accept="image/*" capture="environment"
 *         → Android 直接拉起相机，拍完回填
 *   相册  accept="image/*"（不带 capture）
 *         → Android 弹出图库（或系统相册选择器），可以多选
 *   文件  accept={ACCEPT}（不带 capture）
 *         → 真正的文件管理器，多选
 *
 * ⚠ capture 一旦写上，Android 就会**跳过**图库直接开相机。
 * 所以「相册」那个 input 绝对不能带 capture，否则又回到难用的状态。
 *
 * ⚠ 三个 input 都必须常驻在 DOM 里。Chromium 要求 input.click()
 * 发生在用户手势的同一个任务里；如果等面板关闭动画结束再挂载 input，
 * 点击就脱离了手势上下文，浏览器会静默忽略（这是 Android WebView 很常见
 * 的坑）。所以面板本身控制的是遮罩和按钮的显隐，input 一直存在。
 */
export const AttachmentSheet = ({
  open,
  onClose,
  onFiles,
}: {
  open: boolean
  onClose: () => void
  onFiles: (files: File[]) => void
}) => {
  const t = useTranslate()
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 打开时把面板滚进可视区：真机上键盘可能还开着，面板会被顶到屏幕外
  useEffect(() => {
    if (open) {
      panelRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [open])

  const pick = (ref: React.RefObject<HTMLInputElement | null>) => {
    ref.current?.click()
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFiles(Array.from(event.target.files ?? []))
    // 清空后才能重复选择同一个文件（onChange 依赖 value 变化）
    event.target.value = ''
    onClose()
  }

  return (
    <>
      {open ? (
        <div
          className={styles.backdrop}
          onClick={onClose}
          role="presentation"
          data-testid="attachment-sheet-backdrop"
        />
      ) : null}
      <div
        ref={panelRef}
        className={`${styles.sheet} ${open ? styles.open : ''}`}
        // 关闭时用 visibility 兜底：高度动画结束后不该还能被点到
        aria-hidden={!open}
        data-testid="attachment-sheet"
      >
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            tabIndex={open ? 0 : -1}
            onClick={() => pick(cameraRef)}
          >
            <span className={styles.actionIcon}>
              <IconCameraOutline24 />
            </span>
            <span className={styles.actionLabel}>{t('attachCamera')}</span>
          </button>
          <button
            type="button"
            className={styles.action}
            tabIndex={open ? 0 : -1}
            onClick={() => pick(galleryRef)}
          >
            <span className={styles.actionIcon}>
              <IconGalleryOutline24 />
            </span>
            <span className={styles.actionLabel}>{t('attachGallery')}</span>
          </button>
          <button
            type="button"
            className={styles.action}
            tabIndex={open ? 0 : -1}
            onClick={() => pick(fileRef)}
          >
            <span className={styles.actionIcon}>
              <IconFileOutline24 />
            </span>
            <span className={styles.actionLabel}>{t('attachFile')}</span>
          </button>
        </div>
      </div>

      {/*
        三个 input 常驻，不放进 open 条件里。
        hidden 属性（display:none）不影响 click()，Chromium 允许对隐藏 input 触发选择器。
      */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture={isNative() ? 'environment' : undefined}
        hidden
        onChange={handleChange}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handleChange}
      />
      <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={handleChange} />
    </>
  )
}
