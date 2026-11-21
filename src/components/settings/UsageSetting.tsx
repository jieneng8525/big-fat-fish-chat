import { useEffect, useState } from 'react'
import { Button } from '../base/Button.js'
import { useChatStore } from '../../services/chat/store.js'
import * as db from '../../services/chat/db.js'
import { fetchAccountBalance, type AccountBalance } from '../../services/api/balance.js'
import { useSettings } from '../../services/settings.js'
import {
  formatCost,
  formatTokens,
  mergeUsage,
  sessionUsage,
  type UsageTotals,
} from '../../services/chat/usage.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/**
 * 用量统计。
 *
 * 两个数据源，口径不同，界面上分开写清楚：
 * - 账号余额：调 /user/balance，是真实余额，但只有总额（账号级，多人共用同一笔）
 * - 会话明细：本地 token 统计，能按会话/模型拆，但按高峰价估算
 *
 * 两种口径：
 * - 当前会话：直接用已加载的详情算，零成本
 * - 全部会话：需要逐个读详情，做成按需点按钮，避免每次打开设置都扫全库
 */
export const UsageSetting = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const sessions = useChatStore((state) => state.sessions)
  const sessionCache = useChatStore((state) => state.sessionCache)
  const activeId = useChatStore((state) => state.activeId)
  const [allUsage, setAllUsage] = useState<UsageTotals | null>(null)
  const [busy, setBusy] = useState(false)
  const [balance, setBalance] = useState<AccountBalance | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [balanceBusy, setBalanceBusy] = useState(false)

  // 当前会话的用量：详情已加载时直接算
  const activeSession = activeId && Object.hasOwn(sessionCache, activeId) ? sessionCache[activeId] : undefined
  const current = activeSession ? sessionUsage(activeSession) : null

  // 切换会话后旧的全量统计作废，避免显示成另一个会话的数
  useEffect(() => {
    setAllUsage(null)
  }, [activeId])

  const refreshBalance = async () => {
    if (!apiKey) {
      return
    }
    setBalanceBusy(true)
    setBalanceError(null)
    try {
      setBalance(await fetchAccountBalance(apiKey))
    } catch (error) {
      setBalanceError(error instanceof Error ? error.message : String(error))
    } finally {
      setBalanceBusy(false)
    }
  }

  // 打开设置时自动拉一次余额，失败不影响本地统计的展示
  useEffect(() => {
    void refreshBalance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  const computeAll = async () => {
    setBusy(true)
    try {
      const list: UsageTotals[] = []
      for (const summary of sessions) {
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (session) {
          list.push(sessionUsage(session))
        }
      }
      setAllUsage(mergeUsage(list))
    } finally {
      setBusy(false)
    }
  }

  const shown = allUsage ?? current
  const scope = allUsage ? t('usageScopeAll') : t('usageScopeCurrent')

  return (
    <>
      {/* 账号余额：真实值，来自官网接口 */}
      <div className={styles.row}>
        <div className={styles.text}>
          <div className={styles.label}>{t('settingBalance')}</div>
          <div className={styles.description}>
            {balance
              ? t('balanceSummary', {
                  total: balance.total,
                  currency: balance.currency,
                  granted: balance.granted,
                  toppedUp: balance.toppedUp,
                })
              : balanceError
                ? t('balanceFailed', { message: balanceError })
                : t('balanceLoading')}
          </div>
        </div>
        <div className={styles.wallpaperActions}>
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={balanceBusy || !apiKey}
            onClick={() => void refreshBalance()}
          >
            {balanceBusy ? t('usageComputing') : t('balanceRefresh')}
          </Button>
        </div>
      </div>

      {balance ? (
        <div className={styles.row}>
          <div className={styles.text}>
            <div className={styles.description}>{t('balanceSharedNote')}</div>
          </div>
        </div>
      ) : null}

      {/* 会话明细：本地 token 估算 */}
      <div className={styles.row}>
        <div className={styles.text}>
          <div className={styles.label}>{t('settingUsage')}</div>
          <div className={styles.description}>
            {shown
              ? t('usageSummary', {
                  scope,
                  replies: shown.replies,
                  input: formatTokens(shown.inputTokens),
                  cacheHit: formatTokens(shown.cacheHitTokens),
                  output: formatTokens(shown.outputTokens),
                  cost: formatCost(shown.costYuan),
                })
              : t('usageNoData')}
          </div>
        </div>
        <div className={styles.wallpaperActions}>
          {allUsage ? (
            <Button
              variant="outlined"
              size="m"
              className={styles.cellButton}
              onClick={() => setAllUsage(null)}
            >
              {t('usageBackToCurrent')}
            </Button>
          ) : (
            <Button
              variant="outlined"
              size="m"
              className={styles.cellButton}
              disabled={busy || sessions.length === 0}
              onClick={() => void computeAll()}
            >
              {busy ? t('usageComputing') : t('usageComputeAll')}
            </Button>
          )}
        </div>
      </div>
      {shown && shown.webSearchRequests > 0 ? (
        <div className={styles.row}>
          <div className={styles.text}>
            <div className={styles.description}>
              {t('usageWebSearch', { count: shown.webSearchRequests })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
