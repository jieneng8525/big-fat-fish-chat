import { create } from 'zustand'

/**
 * 搜索索引的补建进度。
 *
 * 索引是后加的存储，已有会话要逐条补建；几百个会话意味着补建期间
 * 搜索结果是残缺的。不提示的话用户只会看到「没有找到匹配的内容」，
 * 不知道是没搜到还是还没建好——所以要有个进度条。
 *
 * 补建只在启动时做一次，建完之后这个状态就是 finished，不再出现。
 */
type IndexProgress = {
  done: number
  total: number
  /** 是否已经建完；建完（或本来就不需要建）后为 true */
  finished: boolean
  update: (done: number, total: number, finished: boolean) => void
}

export const useIndexProgress = create<IndexProgress>((set) => ({
  done: 0,
  total: 0,
  finished: true,
  update: (done, total, finished) => set({ done, total, finished }),
}))
