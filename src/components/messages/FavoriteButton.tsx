import { useTranslate } from '../../i18n/index.js'
import { favoriteKey } from '../../services/chat/favorites.js'
import { useFavorites } from '../../services/chat/favoritesStore.js'
import { IconStar16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'

/**
 * 消息收藏按钮。
 *
 * 状态从共享 store 里查（见 favoritesStore），不在按钮内部读库——
 * 否则一屏几十条回答会发起几十次全表扫描。
 * 乐观更新由 store 负责，这里只管点击。
 */
export const FavoriteButton = ({
  sessionId,
  messageId,
}: {
  sessionId: string
  messageId: string
}) => {
  const t = useTranslate()
  const loaded = useFavorites((state) => state.loaded)
  const starred = useFavorites((state) =>
    state.keys.has(favoriteKey(sessionId, messageId))
  )
  const toggle = useFavorites((state) => state.toggle)

  return (
    <IconButton
      icon={<IconStar16 filled={starred} />}
      tooltip={starred ? t('favoriteRemove') : t('sessionStar')}
      tooltipPlacement="bottom"
      // 状态没加载完前禁用，避免照着错误的初始值点击
      disabled={!loaded}
      onClick={() => {
        void toggle(sessionId, messageId).catch(() => {
          // 失败时 store 不做本地更新，界面自然保持原状
        })
      }}
    />
  )
}
