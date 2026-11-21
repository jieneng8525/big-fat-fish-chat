/**
 * 安卓返回键的统一处理。
 *
 * 背景：网页是单页应用，没有任何 history.pushState，history.length 恒为 1。
 * 不拦截的话，按一次返回键 Android 直接结束 Activity —— 用户什么都还没退就掉出 App。
 * （实测确认：按返回键直接回到桌面。）
 *
 * 期望行为：先关掉当前打开的那一层，都关完了才真正退出。
 * 层级由外到内：设置弹窗 / 搜索面板 / 移动端侧边栏。
 *
 * 这里只做判断，不自己调 Android API —— 由 MainActivity 通过
 * OpenInBrowser 插件之外的一个轻量桥接来问「还能退一步吗」。
 */
import { useSearchPanel, closeSearchPanel } from '../components/search/searchPanelState.js'
import { useSettingsDialog, closeSettings } from '../components/settings/settingsDialogState.js'
import { useMobileSider, closeMobileSider } from '../components/sider/mobileSiderState.js'

/**
 * 返回键按下时的处理。
 *
 * 返回值：true = 自己消费掉了（关掉了某一层），false = 没有可关的，交给系统退出。
 */
export const handleAndroidBack = (): boolean => {
  if (useSettingsDialog.getState().open) {
    closeSettings()
    return true
  }
  if (useSearchPanel.getState().entry !== null) {
    closeSearchPanel()
    return true
  }
  if (useMobileSider.getState().open) {
    closeMobileSider()
    return true
  }
  return false
}

/**
 * 把 handleAndroidBack 挂到 window 上，供原生插件调用。
 *
 * 用 window 上的函数而不是 Capacitor 插件回调，是因为返回键事件在原生侧同步触发，
 * evaluateJavascript 直接调一个全局函数最省事，不需要额外的插件往返。
 */
export const installAndroidBackHandler = (): void => {
  ;(window as { __dshHandleBack?: () => boolean }).__dshHandleBack = handleAndroidBack
}
