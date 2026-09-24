import type { TagLexiconConflict } from '@appTypes/models'
import i18next from 'i18next'
import { toast } from 'sonner'
import { create } from 'zustand'
import { ipcManager } from '~/app/ipc'

const t = (key: string, options?: Record<string, unknown>): string =>
  i18next.t(key, { ns: 'adder', ...(options ?? {}) }) as string

/**
 * 标签冲突（「入库不再自动按文本归并」带来的待决事项）。
 *
 * 与 `versionConflictStore` 分开：那一份是**游戏库**的状态（扫描器与重复条目），
 * 这一份是**词库**的状态（两个概念撞同一个词、抓取写法与已有译名不一致）。
 * 两者只在「冲突管理」对话框的角标与页签上汇合，数据来源与生命周期都不一样。
 *
 * 这里不发 toast：一次扫描可能同时产生版本冲突与标签冲突，两条通知是噪音，
 * 而标签冲突本来就会出现在侧栏角标和冲突面板里，点开可见。
 */
interface TagConflictStore {
  conflicts: TagLexiconConflict[]
  isInitialized: boolean
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  /** 处理一条冲突：`accept` 采纳抓取的新名字 / `keep` 保留现状并不再问 */
  resolve: (id: string, action: 'accept' | 'keep') => Promise<boolean>
}

export const useTagConflictStore = create<TagConflictStore>((set, get) => ({
  conflicts: [],
  isInitialized: false,

  initialize: async (): Promise<void> => {
    if (get().isInitialized) return
    set({ isInitialized: true })

    // 主进程只在数量变化时推送，所以这里无条件重拉一次即可（列表还会被自动剪枝）
    ipcManager.onUnique('tag-lexicon:conflicts-changed', () => {
      void get().refresh()
    })

    await get().refresh()
  },

  refresh: async (): Promise<void> => {
    try {
      set({ conflicts: await ipcManager.invoke('tag-lexicon:conflicts') })
    } catch (error) {
      console.error('[TagConflict] Failed to load conflicts:', error)
    }
  },

  resolve: async (id: string, action: 'accept' | 'keep'): Promise<boolean> => {
    try {
      await ipcManager.invoke('tag-lexicon:conflict-resolve', { id, action })
      await get().refresh()
      toast.success(t('tagConflict.notification.resolved'))
      return true
    } catch (error) {
      console.error('[TagConflict] Failed to resolve the conflict:', error)
      toast.error(t('tagConflict.notification.resolveFailed'))
      return false
    }
  }
}))
