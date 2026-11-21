import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        <ChatInput sessionId={null} />
        {/*
          AI 内容提示只在侧边栏底部显示一条（见 Sider.tsx）。
          这里原来移动端也放了一条，安卓上会和侧边栏那条同时可见，属于重复。
        */}
      </div>
    </div>
  )
}
