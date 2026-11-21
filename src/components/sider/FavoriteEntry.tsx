import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { favoriteSnippet } from '../../services/chat/favorites.js'
import { useFavorites } from '../../services/chat/favoritesStore.js'
import { selectSession } from '../../services/chat/store.js'
import { IconStar16 } from '../base/icons.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './FavoritePanel.module.css'

/**
 * 侧边栏底部的收藏入口。
 *
 * 交互按用户要求做成「一颗黄色星星，光标移上去才显示文字」，
 * 与会话项的 hover 行为一致，平时不占视觉空间。
 *
 * 点开后从星星上方弹出收藏列表；点某条跳到原会话，
 * 原会话已删除的条目只显示文字快照并标注失效。
 */
export const FavoriteEntry = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const items = useFavorites((state) => state.items)
  const loaded = useFavorites((state) => state.loaded)
  const refresh = useFavorites((state) => state.refresh)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 打开时重新读一次，避免别处取消收藏后这里还是旧列表
  useEffect(() => {
    if (open) {
      void refresh().catch(() => {})
    }
  }, [open, refresh])

  // 点外部关闭
  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={t('favoriteMessages')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.star}>
          <IconStar16 filled />
        </span>
        <span className={styles.label}>{t('favoriteMessages')}</span>
        {loaded && items.length > 0 ? <span className={styles.count}>{items.length}</span> : null}
      </button>

      {open ? (
        <div className={styles.panel} role="dialog" aria-label={t('favoriteMessages')}>
          <div className={styles.panelTitle}>{t('favoriteMessages')}</div>
          {items.length === 0 ? (
            <div className={styles.empty}>{t('favoriteEmpty')}</div>
          ) : (
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={clsx(styles.item, item.orphaned && styles.orphaned)}
                    disabled={item.orphaned}
                    onClick={() => {
                      if (item.orphaned) {
                        return
                      }
                      selectSession(item.sessionId)
                      closeMobileSider()
                      setOpen(false)
                    }}
                  >
                    <div className={styles.itemHead}>
                      <span className={styles.itemSession}>
                        {item.sessionTitle || t('untitledChat')}
                      </span>
                      {item.orphaned ? (
                        <span className={styles.orphanTag}>{t('favoriteOrphaned')}</span>
                      ) : null}
                    </div>
                    <div className={styles.itemText}>{favoriteSnippet(item.text)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
