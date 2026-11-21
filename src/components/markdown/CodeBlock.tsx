import { useTranslate } from '../../i18n/index.js'
import { memo, useEffect, useMemo, useReducer, useState } from 'react'
import Prism from 'prismjs'
import {
  getHighlightLang,
  isHighlightLoaded,
  loadHighlight,
} from '../../services/markdown/highlight.js'
import {
  IconCheckOutline16,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconLinkOutline16,
} from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { copyText } from '../../utils/clipboard.js'
import { downloadCodeBlock, extensionOf, openCodeBlockInBrowser } from '../../services/export.js'
import { MermaidDiagram } from './MermaidDiagram.js'
import styles from './CodeBlock.module.css'

/** 代码块标题栏：左侧语言名，右侧复制与下载 */
const CodeInfoRow = ({
  code,
  infostring,
  showDiagram,
  onToggleDiagram,
}: {
  code: string
  infostring: string
  showDiagram: boolean
  onToggleDiagram?: () => void
}) => {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  // 只有能判定成文件格式的代码块才给下载入口；普通示例代码不显示，避免下载出一堆无意义文件
  const extension = useMemo(() => extensionOf(infostring.toLowerCase(), code), [infostring, code])
  return (
    <div className={styles.container}>
      {onToggleDiagram ? (
        <div className="md-code-block-switch" aria-label={t('mermaidSwitchLabel')}>
          <button
            type="button"
            className={styles.button}
            aria-pressed={showDiagram}
            onClick={() => !showDiagram && onToggleDiagram()}
          >
            {t('mermaidDiagram')}
          </button>
          <button
            type="button"
            className={styles.button}
            aria-pressed={!showDiagram}
            onClick={() => showDiagram && onToggleDiagram()}
          >
            {t('mermaidCode')}
          </button>
        </div>
      ) : (
        <span className={styles.name}>{infostring}</span>
      )}
      {extension === 'html' ? (
        <button
          type="button"
          className={styles.button}
          title={t('openInBrowserHint')}
          onClick={() => {
            // 新标签页被拦截时 window.open 返回 null，提示用户放行
            if (!openCodeBlockInBrowser(code, infostring)) {
              showToast({ key: 'openBlocked', type: 'error' })
              return
            }
            // 这段 HTML 的样式由模型生成，它读不到系统深浅色，深色模式下可能白底。
            // 这不是本项目能改的，提示一次，说明见 docs/html-open-note.md
            showToast({ key: 'openInBrowserNote' })
          }}
        >
          <IconLinkOutline16 />
          <span>{t('openInBrowser')}</span>
        </button>
      ) : null}
      {extension !== null ? (
        <button
          type="button"
          className={styles.button}
          title={t('downloadThisBlock', { ext: extension })}
          onClick={() => {
            const result = downloadCodeBlock(code, infostring, t('downloadBlockName'))
            if (!result) {
              showToast({ key: 'exportFailed', type: 'error' })
              return
            }
            setDownloaded(true)
            setTimeout(() => setDownloaded(false), 1500)
            showToast({ key: 'exportDone' })
          }}
        >
          {downloaded ? <IconCheckOutline16 /> : <IconDownloadOutline16 />}
          <span>{t('download')}</span>
        </button>
      ) : null}
      <button
        type="button"
        className={styles.button}
        onClick={async () => {
          if (!(await copyText(code))) {
            showToast({ key: 'copyFailed' })
            return
          }
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        <span>{t(copied ? 'copied' : 'copy')}</span>
      </button>
    </div>
  )
}

/** 代码块：语言包按需加载，不支持或尚未加载的语言按纯文本显示 */
export const CodeBlock = memo(function CodeBlock({
  code,
  infostring,
  loading = false,
}: {
  code: string
  infostring: string
  loading?: boolean
}) {
  const isMermaid = infostring.toLowerCase() === 'mermaid'
  const [showDiagram, setShowDiagram] = useState(true)
  // 语言包注册在全局 Prism 上，每次渲染直接判断；加载完成后触发一次重渲染
  const rerender = useReducer((n: number) => n + 1, 0)[1]
  const lang = getHighlightLang(infostring)
  const loaded = lang !== null && isHighlightLoaded(lang)
  useEffect(() => {
    if (lang === null || loaded) {
      return
    }
    let unmounted = false
    loadHighlight(lang).then(() => {
      if (!unmounted) {
        rerender()
      }
    })
    return () => {
      unmounted = true
    }
  }, [lang, loaded, rerender])
  const renderedHtml = useMemo(() => {
    const name = lang !== null && loaded ? lang : 'plaintext'
    return Prism.highlight(code, Prism.languages[name], name)
  }, [code, lang, loaded])
  return (
    <div className="md-code-block">
      <div className="md-code-block-banner">
        <CodeInfoRow
          code={code}
          infostring={infostring}
          showDiagram={showDiagram}
          onToggleDiagram={isMermaid ? () => setShowDiagram((show) => !show) : undefined}
        />
      </div>
      {isMermaid && showDiagram ? (
        <MermaidDiagram code={code} loading={loading} />
      ) : (
        <pre dangerouslySetInnerHTML={{ __html: renderedHtml }}></pre>
      )}
    </div>
  )
})
