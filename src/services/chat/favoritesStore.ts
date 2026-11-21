import { create } from 'zustand'
import * as db from '../../services/chat/db.js'
import {
  buildFavorite,
  favoriteKey,
  toFavoriteItems,
  type FavoriteItem,
} from '../../services/chat/favorites.js'
import { useChatStore } from './store.js'

/**
 * 收藏状态的共享 store。
 *
 * 为什么不放在每个按钮里各自读库：
 * 一屏可能有几十条回答，每条都 getAll('favorites') 就是几十次全表扫描，
 * 在收藏量大时明显卡顿。这里统一读一次、内存里查，按钮只做 O(1) 的 set 查询。
 */
type FavoritesState = {
  items: FavoriteItem[]
  /** 已收藏的键集合，用于按钮快速判断 */
  keys: Set<string>
  /** 是否完成首次加载 */
  loaded: boolean
  /** 从库里重新读一遍 */
  refresh: () => Promise<void>
  /** 切换某条消息的收藏状态；返回切换后的状态 */
  toggle: (sessionId: string, messageId: string) => Promise<boolean>
}

const buildKeys = (items: FavoriteItem[]) => new Set(items.map((item) => item.id))

export const useFavorites = create<FavoritesState>((set, get) => ({
  items: [],
  keys: new Set<string>(),
  loaded: false,

  refresh: async () => {
    const [all, sessions] = await Promise.all([
      db.loadFavorites(),
      Promise.resolve(useChatStore.getState().sessions),
    ])
    const existing = new Set(sessions.map((session) => session.id))
    const items = toFavoriteItems(all, existing)
    set({ items, keys: buildKeys(items), loaded: true })
  },

  toggle: async (sessionId, messageId) => {
    const key = favoriteKey(sessionId, messageId)
    const currently = get().keys.has(key)
    if (currently) {
      await db.deleteFavorite(key)
      // 本地先行更新，避免等重新读库
      const items = get().items.filter((item) => item.id !== key)
      set({ items, keys: buildKeys(items) })
      return false
    }
    const session = useChatStore.getState().sessionCache[sessionId]
    const message = session?.messages.find((item) => item.id === messageId)
    if (!session || !message) {
      return false
    }
    const favorite = buildFavorite(session, message)
    if (!favorite) {
      // 正文为空（比如纯工具块回答）不收藏
      return false
    }
    await db.saveFavorite(favorite)
    const all = await db.loadFavorites()
    const existing = new Set(useChatStore.getState().sessions.map((s) => s.id))
    const items = toFavoriteItems(all, existing)
    set({ items, keys: buildKeys(items) })
    return true
  },
}))
