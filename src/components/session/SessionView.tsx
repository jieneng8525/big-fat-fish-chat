import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { useSettings } from '../../services/settings.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 有壁纸（手动导入或跟随目录）时顶栏透明，让壁纸透出来；侧边栏保持不透明。
  // 只判断手动壁纸会漏掉跟随模式，那种情况下顶栏仍是不透明的横条。
  const hasManual = useSettings((state) => state.wallpaper !== null)
  const following = useSettings((state) => state.wallpaperFollow)
  const hasWallpaper = hasManual || following
  const title = session.title || t('untitledChat')
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={clsx(styles.header, hasWallpaper && styles.headerTransparent)}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            {/*
              AI 内容提示：桌面端移到侧边栏底部（见 Sider.tsx），
              这里只在移动端保留——移动端侧边栏是抽屉，不常驻，提示放那里看不见。
            */}
            {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
          </div>
        }
      />
    </div>
  )
}
