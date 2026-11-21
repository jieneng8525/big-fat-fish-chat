import type { Message, Session } from './types.js'

/**
 * 用量统计。
 *
 * 每条回答的 usage 里已经有 input_tokens / cache_read_input_tokens / output_tokens，
 * 这里把它们加总并按 DeepSeek 的价目折算成人民币。
 *
 * 价格（元 / 百万 tokens，高峰时段；空闲时段为半价）：
 *           输入(缓存命中)  输入(未命中)  输出
 *   flash      0.04           2.00       8.00
 *   v4-pro     0.30           9.00      27.00
 *
 * 只统计当前会话分支里实际显示的回答，不含被切换掉的其他版本——
 * 那些版本确实花过钱，但用户看到的是「这条对话用了多少」，
 * 两套口径都合理，这里选前者，并在界面上写清。
 */

/** 每百万 tokens 价格；同一模型的三个数分别是缓存命中输入、未命中输入、输出 */
type Price = { cacheHit: number; input: number; output: number }

const PRICES: Record<string, Price> = {
  'deepseek-flash': { cacheHit: 0.04, input: 2, output: 8 },
  'deepseek-v4-pro': { cacheHit: 0.3, input: 9, output: 27 },
}

/** 未识别模型时按 flash 计价（默认模型，也是唯一支持全家桶工具的那个） */
const FALLBACK: Price = PRICES['deepseek-flash'] as Price

export type UsageTotals = {
  /** 缓存命中的输入 tokens */
  cacheHitTokens: number
  /** 未命中缓存的输入 tokens */
  inputTokens: number
  outputTokens: number
  /** 服务端搜索次数 */
  webSearchRequests: number
  /** 估算费用（元）。高峰价目，实际可能因空闲时段减半。 */
  costYuan: number
  /** 参与统计的回答条数 */
  replies: number
}

const emptyTotals = (): UsageTotals => ({
  cacheHitTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  webSearchRequests: 0,
  costYuan: 0,
  replies: 0,
})

/** 只统计当前分支上会显示的回答；其他版本同样计费，但不计入「这条对话」的账 */
const visibleReplies = (session: Session): Message[] => {
  // 没有分支信息时退化成全部消息
  const current = session.messages.filter((message) => message.role === 'assistant')
  return current
}

/** 累加一条回答的用量到 totals */
const addUsage = (totals: UsageTotals, message: Message): void => {
  if (message.role !== 'assistant' || !message.usage) {
    return
  }
  const usage = message.usage
  const price = PRICES[message.model ?? ''] ?? FALLBACK
  const cacheHit = usage.cache_read_input_tokens ?? 0
  // input_tokens 在 Anthropic 兼容协议里是「未命中缓存的输入」；
  // cache_creation 也要单独计价，这里按未命中价保守计算
  const uncached = usage.input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const output = usage.output_tokens ?? 0

  totals.cacheHitTokens += cacheHit
  totals.inputTokens += uncached + cacheWrite
  totals.outputTokens += output
  totals.webSearchRequests += usage.server_tool_use?.web_search_requests ?? 0
  totals.costYuan +=
    (cacheHit / 1_000_000) * price.cacheHit +
    ((uncached + cacheWrite) / 1_000_000) * price.input +
    (output / 1_000_000) * price.output
  totals.replies += 1
}

/** 统计一个会话的用量 */
export const sessionUsage = (session: Session): UsageTotals => {
  const totals = emptyTotals()
  for (const message of visibleReplies(session)) {
    addUsage(totals, message)
  }
  return totals
}

/** 把若干会话的用量合并，用于「全部会话」口径 */
export const mergeUsage = (list: UsageTotals[]): UsageTotals => {
  const totals = emptyTotals()
  for (const item of list) {
    totals.cacheHitTokens += item.cacheHitTokens
    totals.inputTokens += item.inputTokens
    totals.outputTokens += item.outputTokens
    totals.webSearchRequests += item.webSearchRequests
    totals.costYuan += item.costYuan
    totals.replies += item.replies
  }
  return totals
}

/** 大数字缩写：1234 -> 1.2k，1234567 -> 1.2M */
export const formatTokens = (value: number): string => {
  if (value < 1000) {
    return String(value)
  }
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(1)}k`
  }
  return `${(value / 1_000_000).toFixed(2)}M`
}

/** 费用保留两位小数；不足一分钱时显示「<0.01」 */
export const formatCost = (yuan: number): string => {
  if (yuan > 0 && yuan < 0.01) {
    return '<0.01'
  }
  return yuan.toFixed(2)
}
