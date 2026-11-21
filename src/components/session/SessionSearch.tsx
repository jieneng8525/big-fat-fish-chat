import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { OPEN_SEARCH_EVENT } from '../../app/shortcutEvents.js'
import { loadSearchEntries } from '../../services/chat/db.js'
import { useIndexProgress } from '../../services/chat/indexProgress.js'
import { searchEntries } from '../../services/chat/search.js'
import type { StoredSearchEntry } from '../../services/chat/db.js'
import styles from './SessionSearch.module.css'

/**
 * 顶栏搜索：在全部会话的消息正文和标题里找关键词。
 *
 * 索引在保存会话时同步维护（见 db.saveSession），这里只在打开搜索时读一次，
 * 之后输入都在内存里过滤，几百个会话也不会卡。
 *
 * 目前点击结果只负责「打开那个会话」，不跳到具体某条消息——
 * 消息列表还没有可定位的锚点，要做得额外引入滚动逻辑，先不做，避免半成品。
 */
export const SessionSearch = ({
  onOpenSession,
}: {
  onOpenSession: (sessionId: string) => void
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [entries, setEntries] = useState<StoredSearchEntry[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 索引补建进度：没建完时搜出来的结果是不全的 */
  const progress = useIndexProgress()
  const indexing = !progress.finished

  /*
   * 补建期间索引在变，已加载的条目可能是旧的。
   * 补建完成后重新读一次，否则搜到的还是补建前那份残缺索引。
   */
  useEffect(() => {
    if (progress.finished && open) {
      void loadSearchEntries().then(setEntries)
    }
  }, [progress.finished, open])

  // 打开时才加载索引，避免每次进会话都读一遍
  useEffect(() => {
    if (!open || entries !== null) {
      return
    }
    let cancelled = false
    void loadSearchEntries().then((list) => {
      if (!cancelled) {
        setEntries(list)
      }
    })
    return () => {
      cancelled = true
    }
  }, [open, entries])

  // 打开后自动聚焦，省一次点击
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  // Ctrl/Cmd+F 由全局快捷键派发事件，这里收到就展开面板
  useEffect(() => {
    const openPanel = () => setOpen(true)
    window.addEventListener(OPEN_SEARCH_EVENT, openPanel)
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, openPanel)
  }, [])

  const hits = useMemo(
    () => (entries && keyword.trim() ? searchEntries(entries, keyword) : []),
    [entries, keyword]
  )

  const close = () => {
    setOpen(false)
    setKeyword('')
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={t('searchMessages')}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div className={styles.panel} role="dialog" aria-label={t('searchMessages')}>
          <div className={styles.inputRow}>
            <input
              ref={inputRef}
              className={styles.input}
              value={keyword}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchMessages')}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  close()
                }
              }}
            />
            <button type="button" className={styles.close} aria-label={t('close')} onClick={close}>
              ×
            </button>
          </div>

          {/*
            索引补建进度。没建完时搜索结果是不全的，必须让用户看见，
            否则只会显示「没有找到匹配的内容」，看不出是没搜到还是没建好。
          */}
          {indexing ? (
            <div className={styles.progress}>
              <div className={styles.progressText}>
                {t('searchIndexing', { done: progress.done, total: progress.total })}
              </div>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressBar}
                  style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ) : null}

          {keyword.trim() ? (
            hits.length > 0 ? (
              <ul className={styles.list}>
                {hits.map((hit) => (
                  <li key={hit.sessionId + hit.messageId + hit.matchStart}>
                    <button
                      type="button"
                      className={styles.hit}
                      onClick={() => {
                        onOpenSession(hit.sessionId)
                        close()
                      }}
                    >
                      <div className={styles.hitTitle}>{hit.title || t('untitledChat')}</div>
                      <div className={styles.hitSnippet}>
                        {hit.snippet.slice(0, hit.matchStart)}
                        <mark className={styles.mark}>
                          {hit.snippet.slice(hit.matchStart, hit.matchEnd)}
                        </mark>
                        {hit.snippet.slice(hit.matchEnd)}
                      </div>
                      <div className={styles.hitRole}>
                        {hit.messageId ? (hit.role === 'user' ? t('searchInQuestion') : t('searchInAnswer')) : t('searchInTitle')}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={clsx(styles.empty)}>
                {indexing ? t('searchIndexingWait') : t('searchEmpty')}
              </div>
            )
          ) : (
            <div className={styles.empty}>{t('searchHint')}</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
