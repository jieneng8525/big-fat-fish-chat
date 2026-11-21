import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useUploads } from '../../services/attachments.js'
import { loadFile } from '../../services/chat/db.js'
import type { FileAttachment } from '../../services/chat/types.js'
import { isNative, openAttachmentNatively } from '../../services/nativeShell.js'
import { IconPhotoErrorFill20, IconRefreshOutline16 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import { FileCard } from '../files/FileCard.js'
import styles from './MessageFile.module.css'

/**
 * 原件从 IndexedDB 读出并生成本地地址。
 *
 * 同时返回 blob 本体：安卓端打开附件时要把它写成临时文件交给系统，
 * 只靠 blob URL 在 WebView 之外拿不到内容（见 nativeShell.openAttachmentNatively）。
 *
 * url 为 undefined 表示加载中，null 表示原件缺失。
 */
const useFileUrl = (id: string): { url: string | null | undefined; blob: Blob | null } => {
  const [state, setState] = useState<{ id: string; url: string | null; blob: Blob | null } | null>(
    null
  )
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    loadFile(id).then((blob) => {
      if (!cancelled) {
        objectUrl = blob ? URL.createObjectURL(blob) : null
        setState({ id, url: objectUrl, blob: blob ?? null })
      }
    })
    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [id])
  const ready = state?.id === id
  return { url: ready ? state.url : undefined, blob: ready ? state.blob : null }
}

/** 历史或失效附件的补传状态：只在还没有 serverId 时显示 */
const useUploadState = (file: FileAttachment) =>
  useUploads((state) => {
    if (file.serverId) {
      return null
    }
    const task = state.tasks[file.id]
    return task?.status === 'uploading' || task?.status === 'error' ? task : null
  })

/**
 * 消息里的附件：
 * - 图片：纯图片显示 120×120 缩略图，与文件混排时为 64×64；上传中显示 loading 蒙层，
 *   上传失败显示品牌色描边 + 中心重试图标（可重试）或 photo-error 图标（不可重试）。
 * - 文件：显示文件卡片。
 */
export const MessageFile = ({
  file,
  onRetry,
}: {
  file: FileAttachment
  /** 本条消息补传失败且可重试时提供 */
  onRetry: (() => void) | null
}) => {
  const t = useTranslate()
  const { url, blob } = useFileUrl(file.id)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const upload = useUploadState(file)
  const uploading = upload?.status === 'uploading'
  const failed = upload?.status === 'error'
  const retryable = failed && upload.retryable
  const errorText = failed ? t(upload.error.key, upload.error.params) : undefined

  const retry = retryable ? onRetry : null

  /**
   * 打开原件。
   *
   * 网页端：window.open(blobUrl) 开新标签页，行为正常。
   * App 端：WebView 会把 target="_blank" 交给系统，而 blob: URL 只在当前
   *   WebView 进程内有效，系统那边拿不到内容 —— 表现为「点了没反应」。
   *   实测确认过：图片和文档都是这个原因。
   *   所以改成把 Blob 写成临时文件，用 Intent.ACTION_VIEW 交给系统应用打开。
   */
  const open = () => {
    if (!url) {
      return
    }
    if (isNative() && blob) {
      void openAttachmentNatively(file.id, blob, file.name).then((ok) => {
        if (!ok) {
          // 系统打不开（没有对应应用）时退回新窗口，至少网页端能用
          window.open(url, '_blank', 'noreferrer')
        }
      })
      return
    }
    window.open(url, '_blank', 'noreferrer')
  }

  if (file.isImage && url !== null) {
    const preview = url ? (
      failedUrl === url ? (
        <span className={styles.failedIcon} role="img" aria-label={file.name}>
          <IconPhotoErrorFill20 />
        </span>
      ) : (
        <img src={url} alt={file.name} onError={() => setFailedUrl(url)} />
      )
    ) : null

    // 上传中：本地原件已在 IndexedDB，先垫在蒙层下显示，避免只有一块灰色占位
    if (uploading) {
      return (
        <div className={clsx(styles.image, styles.imageThumb)} title={file.name}>
          {preview}
          <div className={styles.overlay}>
            <span className={styles.spinner} />
          </div>
        </div>
      )
    }

    // 「上传失败」只显示状态，其余原因写在图片底部的渐变上
    const reason =
      errorText && errorText !== t('uploadFileStatusFailed') ? (
        <span className={styles.reason}>{errorText}</span>
      ) : null

    // 上传失败不可重试：保留缩略图，底部渐变显示原因
    if (failed && !retry) {
      return (
        <div
          className={clsx(styles.image, styles.imageThumb)}
          title={errorText}
          aria-label={errorText}
        >
          {preview ?? (
            <span className={styles.failedIcon}>
              <IconPhotoErrorFill20 />
            </span>
          )}
          {reason}
        </div>
      )
    }

    // 上传失败可重试：缩略图 + 红色描边 + 蒙层重试图标，原因在底部
    if (failed && retry) {
      const retryLabel = t('uploadRetry', { message: errorText ?? t('uploadFileStatusFailed') })
      return (
        <Tooltip content={retryLabel}>
          <button
            type="button"
            className={clsx(styles.image, styles.imageThumb, styles.retryImage)}
            aria-label={retryLabel}
            onClick={retry}
          >
            {preview}
            <div className={clsx(styles.overlay, styles.retryOverlay)}>
              <IconRefreshOutline16 />
            </div>
            {reason}
          </button>
        </Tooltip>
      )
    }

    // 正常态：点击打开原件（App 内交给系统应用，网页端开新标签页）
    return url ? (
      <button
        type="button"
        className={clsx(styles.image, styles.imageThumb)}
        onClick={open}
        title={file.name}
        aria-label={file.name}
      >
        {preview}
      </button>
    ) : (
      // 原件还没加载出来（极短暂）
      <div className={styles.image} />
    )
  }

  return (
    <FileCard
      name={file.name}
      size={file.size}
      status={uploading ? 'uploading' : failed ? 'error' : 'done'}
      error={errorText}
      onRetry={retry ?? undefined}
      onOpen={url && !upload ? open : undefined}
    />
  )
}
