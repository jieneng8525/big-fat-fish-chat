import { getReplyText } from './reply.js'
import type { Message, Session } from './types.js'
import type { StoredFavorite } from './db.js'

/**
 * 消息收藏。
 *
 * 设计取舍见 db.ts 里 StoredFavorite 的注释：独立存储 + 正文快照，
 * 这样「收藏跨会话可浏览」和「原会话删了收藏仍在」两个性质才成立。
 */

/** 收藏键：会话 id 与消息 id 拼接，保证同一条消息只收藏一次 */
export const favoriteKey = (sessionId: string, messageId: string): string =>
  `${sessionId}:${messageId}`

/** 从一条消息里取要收藏的正文 */
const messageText = (message: Message): string => {
  if (message.role === 'user') {
    return message.content
  }
  // 只收藏正文，思考过程是内部推理，存下来没有阅读价值
  return getReplyText(message)
}

/** 由会话与消息构造一条收藏记录；正文为空时不收藏，返回 null */
export const buildFavorite = (
  session: Session,
  message: Message,
  now = Date.now()
): StoredFavorite | null => {
  const text = messageText(message).trim()
  if (!text) {
    return null
  }
  return {
    id: favoriteKey(session.id, message.id),
    sessionId: session.id,
    messageId: message.id,
    sessionTitle: session.title,
    role: message.role,
    text,
    createdAt: now,
  }
}

/** 收藏列表的展示项：附带「原会话是否还在」，用于提示失效 */
export type FavoriteItem = StoredFavorite & {
  /** 原会话已被删除；正文快照仍在，只是点不回去了 */
  orphaned: boolean
}

/** 按收藏时间倒序排列，并标记原会话是否还存在 */
export const toFavoriteItems = (
  favorites: StoredFavorite[],
  existingSessionIds: Set<string>
): FavoriteItem[] =>
  [...favorites]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((item) => ({ ...item, orphaned: !existingSessionIds.has(item.sessionId) }))

/** 收藏正文的摘要：列表里只显示一行左右 */
export const favoriteSnippet = (text: string, limit = 110): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}
