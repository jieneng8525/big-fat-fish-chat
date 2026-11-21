/**
 * 账号余额查询。
 *
 * 调 DeepSeek 开放平台的 /user/balance，返回真实的账号余额。
 * 这是「真值」——比本地按 token 估算准得多，但它只给总额，不给明细：
 * 不告诉你哪个会话花了多少、哪个模型花了多少。
 *
 * 实测（2026-11-21）返回：
 *   { "is_available": true,
 *     "balance_infos": [{ "currency": "CNY", "total_balance": "21.46",
 *                         "granted_balance": "0.00", "topped_up_balance": "21.46" }] }
 *
 * ⚠ 不要用「两次余额之差」推算某次对话的费用：
 * 余额更新有延迟，而且同一账号多人的消耗会混在一起，差值必然对不上。
 * 明细一律用本地 token 统计（见 usage.ts），余额只用来回答「还剩多少」。
 */

import { API_ORIGIN, request } from './client.js'

export type AccountBalance = {
  /** 是否可用（余额充足且账号正常） */
  available: boolean
  currency: string
  /** 总余额 */
  total: string
  /** 赠送余额 */
  granted: string
  /** 充值余额 */
  toppedUp: string
  /** 查询成功的时间戳，用于显示「几分钟前」 */
  fetchedAt: number
}

/** 解析接口返回；格式不符时返回 null，由调用方决定怎么提示 */
const parseBalance = (body: unknown): Omit<AccountBalance, 'fetchedAt'> | null => {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const raw = body as {
    is_available?: unknown
    balance_infos?: unknown
  }
  if (!Array.isArray(raw.balance_infos) || raw.balance_infos.length === 0) {
    return null
  }
  const info = raw.balance_infos[0] as {
    currency?: unknown
    total_balance?: unknown
    granted_balance?: unknown
    topped_up_balance?: unknown
  }
  return {
    available: raw.is_available === true,
    currency: typeof info.currency === 'string' ? info.currency : 'CNY',
    total: typeof info.total_balance === 'string' ? info.total_balance : '—',
    granted: typeof info.granted_balance === 'string' ? info.granted_balance : '—',
    toppedUp: typeof info.topped_up_balance === 'string' ? info.topped_up_balance : '—',
  }
}

/** 查询账号余额；失败时抛 ApiError，由调用方展示原因 */
export const fetchAccountBalance = async (
  apiKey: string,
  signal?: AbortSignal
): Promise<AccountBalance> => {
  const response = await request(`${API_ORIGIN}/user/balance`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
  const parsed = parseBalance(await response.json())
  if (!parsed) {
    throw new Error('余额接口返回格式无法识别')
  }
  return { ...parsed, fetchedAt: Date.now() }
}
