import { useEffect } from 'react'
import clsx from 'clsx'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { useGlobalShortcuts } from './shortcuts.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { WallpaperLayer } from '../components/session/WallpaperLayer.js'
import { isDarkWallpaper } from '../components/session/WallpaperLayer.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 有壁纸（手动导入或目录选择）时，浅色主题需要调整文字保证对比度
  const hasManualWallpaper = useSettings((state) => state.wallpaper !== null)
  const followingWallpaper = useSettings((state) => state.wallpaperFollow)
  const hasWallpaper = hasManualWallpaper || followingWallpaper
  // 暗壁纸要换成浅色文字（与 WallpaperLayer 用同一个判定函数，两处必须一致）
  const darkWallpaper = useSettings((state) => isDarkWallpaper(state.wallpaperBrightness))
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 全局快捷键：Ctrl+K 新对话、Ctrl+F 搜索、Esc 停止生成
  useGlobalShortcuts()

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat()
    // 首次打开先在设置里输入 API Key
    ensureApiKey()
  }, [])

  return (
    <>
      {/*
        onWallpaper：有壁纸时给 frame 加标记。
        浅色主题下壁纸上方叠了半透明白纱，正文对比度会掉到 3.4/2.2（低于 WCAG 4.5/3.0），
        需要在这一层加深文字；深色主题与无壁纸时不受影响。
      */}
      <div
        ref={frameRef}
        className={clsx(
          styles.frame,
          /*
           * onWallpaper 与 onDarkWallpaper 必须互斥。
           * 两者都定义 --dsw-alias-label-secondary / -tertiary：
           * onWallpaper 是「亮壁纸 + 深字」，onDarkWallpaper 是「暗壁纸 + 浅字」，
           * 同时挂上时谁后加载谁生效，结果不可预测——实测就是正文被 onWallpaper
           * 的深色值盖住，暗壁纸上一片深色字。
           */
          hasWallpaper && !darkWallpaper && styles.onWallpaper,
          /*
           * 这里刻意用字符串而不是 styles.onDarkWallpaper。
           *
           * 那个类名的样式定义在 theme.css（普通 CSS，不加 hash），而 CSS Module
           * 会给 styles 里的每个键加上 `-<hash>` 后缀，两边永远对不上。
           * 用 :global(.onDarkWallpaper) 让它参与导出也试过：rspack 不导出 global 规则，
           * styles.onDarkWallpaper 会是 undefined，clsx 直接跳过，类名同样挂不上。
           * 直接写死字符串是最稳的做法，theme.css 里的选择器与之一一对应。
           */
          hasWallpaper && darkWallpaper && 'onDarkWallpaper'
        )}
      >
        <WallpaperLayer />
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <Toast />
    </>
  )
}
