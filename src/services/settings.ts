import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import type { Wallpaper } from './wallpaper.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 是否把界面深浅色告诉模型（默认关，原因见 store.ts 的 colorSchemeHint） */
  tellModelColorScheme: boolean
  /** 当前壁纸的元信息；原件在 IndexedDB，这里只存引用，存 localStorage */
  wallpaper: Wallpaper | null
  /**
   * 是否跟随用户授权目录里的壁纸。
   * 仅 Chromium 系浏览器可用；其他浏览器入口隐藏，此值恒为 false。
   */
  wallpaperFollow: boolean
  /** 跟随目录时选中的文件名（目录里有多张壁纸时记住选择） */
  wallpaperFollowFile: string | null
  /**
   * 当前壁纸的平均亮度（0 黑 ~ 1 白），运行时测量，不持久化。
   * null 表示还没测出来或没有壁纸。
   * 用途：浅色主题下决定文字用深色还是浅色——亮壁纸配深字、暗壁纸配浅字。
   */
  wallpaperBrightness: number | null
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  wallpaper: 'chat-demo:wallpaper',
  wallpaperFollow: 'chat-demo:wallpaper-follow',
  wallpaperFollowFile: 'chat-demo:wallpaper-follow-file',
  tellModelColorScheme: 'chat-demo:tell-model-color-scheme',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 壁纸元信息：写坏的 JSON 视为没有壁纸，不让设置读取崩掉 */
const initialWallpaper = (): Wallpaper | null => {
  try {
    const saved: unknown = JSON.parse(read(KEYS.wallpaper) ?? 'null')
    if (
      typeof saved === 'object' &&
      saved !== null &&
      typeof (saved as Wallpaper).id === 'string' &&
      ((saved as Wallpaper).kind === 'image' || (saved as Wallpaper).kind === 'video')
    ) {
      return saved as Wallpaper
    }
    return null
  } catch {
    return null
  }
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  tellModelColorScheme: read(KEYS.tellModelColorScheme) === 'true',
  wallpaper: initialWallpaper(),
  wallpaperFollow: read(KEYS.wallpaperFollow) === 'true',
  wallpaperFollowFile: read(KEYS.wallpaperFollowFile),
  wallpaperBrightness: null,
}))

/** 亮度由 WallpaperLayer 测量后写入，不持久化——每次加载壁纸重新测 */
export const setWallpaperBrightness = (wallpaperBrightness: number | null) => {
  useSettings.setState({ wallpaperBrightness })
}

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setWallpaper = (wallpaper: Wallpaper | null) => {
  write(KEYS.wallpaper, wallpaper ? JSON.stringify(wallpaper) : null)
  useSettings.setState({ wallpaper })
}

export const setTellModelColorScheme = (tellModelColorScheme: boolean) => {
  write(KEYS.tellModelColorScheme, String(tellModelColorScheme))
  useSettings.setState({ tellModelColorScheme })
}

/** 开启/关闭跟随桌面壁纸；关闭时一并清掉选中的文件名 */
export const setWallpaperFollow = (wallpaperFollow: boolean) => {
  write(KEYS.wallpaperFollow, String(wallpaperFollow))
  useSettings.setState({ wallpaperFollow })
  if (!wallpaperFollow) {
    write(KEYS.wallpaperFollowFile, null)
    useSettings.setState({ wallpaperFollowFile: null })
  }
}

export const setWallpaperFollowFile = (wallpaperFollowFile: string | null) => {
  write(KEYS.wallpaperFollowFile, wallpaperFollowFile)
  useSettings.setState({ wallpaperFollowFile })
}
