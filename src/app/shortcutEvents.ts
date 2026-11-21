/**
 * 全局快捷键的共享常量。
 *
 * 单独一个文件是为了断开循环导入：
 * shortcuts.ts 依赖 store.ts（要调 newChat / stopReply），
 * 而 SessionSearch.tsx 只需要事件名。
 * 如果它直接从 shortcuts.ts 取常量，就会形成
 * SessionSearch → shortcuts → store → … → SessionSearch 的环。
 */
export const OPEN_SEARCH_EVENT = 'chat-demo:open-search'
