import i18next from 'i18next'
import { toast } from 'sonner'
import { create } from 'zustand'
import type {
  VersionReviewDetail,
  VersionReviewRefreshResult,
  VersionReviewSavePayload,
  VersionReviewSummary
} from '@appTypes/utils'
import { ipcManager } from '~/app/ipc'

const t = (key: string, options?: Record<string, unknown>): string =>
  i18next.t(key, { ns: 'adder', ...(options ?? {}) }) as string

/**
 * Everything the version-conflict workbench needs.
 *
 * The list is owned here rather than by the dialog because the sidebar badge, the settings entry
 * and the dialog itself all read it, and because a scan can raise a conflict while none of them is
 * open — the main process pushes the new list and the badge has to follow.
 */
interface VersionConflictStore {
  reviews: VersionReviewSummary[]
  isDialogOpen: boolean
  /** Game whose versions the dialog is editing; `null` shows the poster-card overview. */
  selectedGameId: string | null
  isInitialized: boolean
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  setDialogOpen: (open: boolean) => void
  selectGame: (gameId: string | null) => void
  getDetail: (gameId: string) => Promise<VersionReviewDetail | null>
  refreshDetail: (gameId: string) => Promise<VersionReviewRefreshResult | null>
  checkPaths: (paths: string[]) => Promise<Record<string, boolean>>
  save: (payload: VersionReviewSavePayload) => Promise<boolean>
}

export const useVersionConflictStore = create<VersionConflictStore>((set, get) => ({
  reviews: [],
  isDialogOpen: false,
  selectedGameId: null,
  isInitialized: false,

  initialize: async (): Promise<void> => {
    if (get().isInitialized) return
    set({ isInitialized: true })

    ipcManager.onUnique('version-conflict:changed', (_, reviews) => {
      const grew = reviews.length > get().reviews.length
      set({ reviews })

      if (!grew) return
      toast.warning(t('versionConflict.notification.title'), {
        id: 'version-conflict',
        description: t('versionConflict.notification.description', { total: reviews.length }),
        action: {
          label: t('versionConflict.notification.review'),
          onClick: () => set({ isDialogOpen: true, selectedGameId: null })
        }
      })
    })

    await get().refresh()
  },

  refresh: async (): Promise<void> => {
    try {
      set({ reviews: await ipcManager.invoke('version-review:list') })
    } catch (error) {
      console.error('[VersionConflict] Failed to load reviews:', error)
    }
  },

  setDialogOpen: (open: boolean): void => {
    // Reopening always starts on the overview: a game that was resolved last time is gone from the
    // list, and the grid is the only view that reflects that.
    set({ isDialogOpen: open, selectedGameId: null })
  },

  selectGame: (gameId: string | null): void => set({ selectedGameId: gameId }),

  getDetail: async (gameId: string): Promise<VersionReviewDetail | null> => {
    try {
      return await ipcManager.invoke('version-review:get', gameId)
    } catch (error) {
      console.error('[VersionConflict] Failed to load the review:', error)
      toast.error(t('versionConflict.notification.loadFailed'))
      return null
    }
  },

  /**
   * Re-check one game against the disk: folders deleted by hand are noticed and their conflict
   * records are deleted with them, so the panel stops asking about directories that are gone.
   *
   * `reviews` is taken from the result because the cleanup can settle a game completely, and then
   * its card has to disappear from the overview (and from the sidebar badge) too.
   */
  refreshDetail: async (gameId: string): Promise<VersionReviewRefreshResult | null> => {
    try {
      const result = await ipcManager.invoke('version-review:refresh', gameId)
      set({ reviews: result.reviews })
      return result
    } catch (error) {
      console.error('[VersionConflict] Failed to re-check the directories:', error)
      toast.error(t('versionConflict.notification.refreshFailed'))
      return null
    }
  },

  checkPaths: async (paths: string[]): Promise<Record<string, boolean>> => {
    if (paths.length === 0) return {}
    try {
      return await ipcManager.invoke('version-review:check-paths', paths)
    } catch (error) {
      console.error('[VersionConflict] Failed to probe directories:', error)
      return {}
    }
  },

  save: async (payload: VersionReviewSavePayload): Promise<boolean> => {
    try {
      const result = await ipcManager.invoke('version-review:save', payload)
      set({ reviews: result.reviews })

      if (!result.success) {
        toast.error(result.error || t('versionConflict.notification.saveFailed'))
        return false
      }
      if (result.error) {
        // The versions were written; only the cleanup of a merged entry failed.
        toast.warning(t('versionConflict.notification.partialSave'), {
          description: result.error
        })
        return true
      }

      toast.success(t('versionConflict.notification.saved'))
      return true
    } catch (error) {
      console.error('[VersionConflict] Failed to save:', error)
      toast.error(t('versionConflict.notification.saveFailed'))
      return false
    }
  }
}))
