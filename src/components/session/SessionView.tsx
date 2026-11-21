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
              AI 内容提示不放在这里。
              原来移动端会在输入框下方再放一条，但：
              1. 侧边栏底部已经常驻一条，安卓上两处同时可见，等于重复
              2. 这一层贴在输入框底部，会在输入框下缘压出一道横条（安卓实机看到的是黑角）
              统一只在 Sider.tsx 里显示一条。
            */}
          </div>
        }
      />
    </div>
  )
}
