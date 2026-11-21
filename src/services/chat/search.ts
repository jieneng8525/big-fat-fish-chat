import { getReplyText } from './reply.js'
import type { Message, Session } from './types.js'
import type { StoredSearchEntry } from './db.js'

/**
 * 会话全文搜索。
 *
 * 架构：每个会话在 searchIndex 里存一条纯文本记录（保存会话时同步更新）。
 * 搜索时一次 getAll 在内存里过滤，避免逐个打开会话读详情——
 * 用户有几百个会话，逐个读会明显卡顿。
 *
 * 为什么不用 IndexedDB 自带索引：中文没有空格分词，
 * 内置索引只能做前缀匹配，搜「壁纸」匹配不到「能不能用壁纸」。
 */

/** 一条命中：哪个会话、哪条消息、命中的片段 */
export type SearchHit = {
  sessionId: string
  title: string
  messageId: string
  role: 'user' | 'assistant'
  /** 命中位置周围的片段，用于在列表里展示上下文 */
  snippet: string
  /** 片段中命中词的起止位置（相对 snippet），用于高亮 */
  matchStart: number
  matchEnd: number
  updatedAt: number
}

/** 从一条消息里取可搜索的纯文本 */
const messageText = (message: Message): string => {
  if (message.role === 'user') {
    return message.content
  }
  // 只取正文，思考过程不参与搜索：它是内部推理，搜到也没用
  return getReplyText(message)
}

/** 构建一条会话的索引记录 */
export const buildSearchEntry = (session: Session): StoredSearchEntry => ({
  id: session.id,
  title: session.title,
  messages: session.messages
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: messageText(message),
    }))
    .filter((item) => item.text.trim() !== ''),
  updatedAt: session.updatedAt,
})

/** 片段前后各留多少字符 */
const SNIPPET_PAD = 40

/** 在文本里找到查询词，返回带上下文的片段与命中位置 */
const makeSnippet = (text: string, query: string): Omit<SearchHit, 'sessionId' | 'title' | 'messageId' | 'role' | 'updatedAt'> | null => {
  const lower = text.toLowerCase()
  const at = lower.indexOf(query)
  if (at < 0) {
    return null
  }
  const start = Math.max(0, at - SNIPPET_PAD)
  const end = Math.min(text.length, at + query.length + SNIPPET_PAD)
  // 片段两端补省略号，让用户知道这不是完整内容
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  const raw = text.slice(start, end).replace(/\s+/g, ' ')
  return {
    snippet: prefix + raw + suffix,
    matchStart: prefix.length + (at - start),
    matchEnd: prefix.length + (at - start) + query.length,
  }
}

/** 结果数量上限：再多用户也翻不完，只会拖慢渲染 */
const MAX_HITS = 50

/**
 * 在已加载的索引里搜索。
 * 查询词会被转成小写做不区分大小写的匹配；空白查询返回空结果。
 */
export const searchEntries = (entries: StoredSearchEntry[], keyword: string): SearchHit[] => {
  const query = keyword.trim().toLowerCase()
  if (!query) {
    return []
  }
  const hits: SearchHit[] = []
  for (const entry of entries) {
    // 标题命中优先：用户多半是找「那个叫什么什么」的会话
    const titleHit = entry.title.toLowerCase().includes(query)
    if (titleHit) {
      const at = entry.title.toLowerCase().indexOf(query)
      hits.push({
        sessionId: entry.id,
        title: entry.title,
        // 标题命中的消息 id 用空串表示「会话级命中」
        messageId: '',
        role: 'user',
        snippet: entry.title,
        matchStart: at,
        matchEnd: at + query.length,
        updatedAt: entry.updatedAt,
      })
    }
    for (const message of entry.messages) {
      if (hits.length >= MAX_HITS) {
        break
      }
      const snippet = makeSnippet(message.text, query)
      if (snippet) {
        hits.push({
          sessionId: entry.id,
          title: entry.title,
          messageId: message.id,
          role: message.role,
          ...snippet,
          updatedAt: entry.updatedAt,
        })
      }
    }
    if (hits.length >= MAX_HITS) {
      break
    }
  }
  // 最近更新的排前面
  return hits.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_HITS)
}
