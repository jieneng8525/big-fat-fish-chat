import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { installAndroidBackHandler } from './app/androidBack.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
// 安卓返回键：先关掉打开的弹窗/抽屉，都关完了才退出（原生侧调用 window.__dshHandleBack）
installAndroidBackHandler()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
