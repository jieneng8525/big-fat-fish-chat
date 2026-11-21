import { useEffect } from 'react'
import { newChat, stopReply, useChatStore } from '../services/chat/store.js'
import { OPEN_SEARCH_EVENT } from './shortcutEvents.js'

/**
 * 全局快捷键。
 *
 *   Ctrl/Cmd + K     新建对话
 *   Ctrl/Cmd + F     搜索全部对话（展开侧边栏的搜索面板）
 *   Esc → F2         停止当前生成（先按 Esc，再按 F2）
 *
 * 为什么停止生成用「Esc 后接 F2」而不是单个 Esc：
 * 窗口内按 Esc 太容易误触（弹层、输入框都在用），浏览器全屏等原生行为也会抢这个键；
 * 单独 Ctrl+Esc 又撞 Windows 的开始菜单。两段式组合不占用系统热键。
 *
 * 序列规则：按 Esc 后在 ESC_WINDOW 毫秒内按 F2 才触发；
 * 超时或按了别的键就作废，避免误按。
 *
 * 输入法组合中（composition）一律跳过，否则中文选词会被打断。
 */

/** Esc 之后等多久的 F2；太短来不及按，太长容易误触 */
const ESC_WINDOW = 1500

export const useGlobalShortcuts = () => {
  const activeId = useChatStore((state) => state.activeId)

  useEffect(() => {
    let escAt = 0

    const onKeyDown = (event: KeyboardEvent) => {
      // 输入法组合中不处理，避免打断选词
      if (event.isComposing) {
        return
      }
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (mod && key === 'k') {
        event.preventDefault()
        newChat()
        return
      }

      if (mod && key === 'f') {
        // 没有打开会话时搜索没意义，让浏览器默认查找接管
        if (!activeId) {
          return
        }
        event.preventDefault()
        window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT))
        return
      }

      // 第一段：按 Esc 记下时间。这里不 preventDefault，
      // 弹层、输入法的 Esc 行为要照常工作。
      if (event.key === 'Escape') {
        escAt = Date.now()
        return
      }

      // 第二段：窗口内按 F2 才停
      if (event.key === 'F2') {
        if (Date.now() - escAt <= ESC_WINDOW) {
          escAt = 0
          if (activeId && Object.hasOwn(useChatStore.getState().streaming, activeId)) {
            event.preventDefault()
            stopReply(activeId)
          }
          return
        }
      }

      // 按了别的键：序列作废，避免用户按了 Esc 之后去干别的又误触 F2
      escAt = 0
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeId])
}
