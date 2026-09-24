import { create } from 'zustand'
import { ipcManager } from '~/app/ipc'

export interface GamePathInfo {
  valid: boolean | null // null for uncheck
  lastChecked?: number
}

export interface GamePathStore {
  paths: Record<string, GamePathInfo> // key = path

  /**
   * gameId -> every directory the game's versions point at (`utils.markPath`, or the folder
   * holding `path.gamePath`). Empty entries are dropped, so `[]` means "no directory at all" —
   * a game that was never pointed at anything on disk.
   *
   * Kept separate from `paths` so `paths[gamePath]` stays a *file* lookup for the local flag.
   */
  gameDirectories: Record<string, string[]>

  addPaths: (paths: string[]) => void
  setGameDirectories: (gameId: string, directories: string[]) => void
  removeGameDirectories: (gameId: string) => void
  setValidity: (path: string, valid: boolean) => void
  verifyAll: () => Promise<void>
  recheckAll: () => Promise<void>
  requestValidity: (path: string) => Promise<void>
  clear: () => void
}

/**
 * Whether every directory a game's versions point at is gone.
 *
 * `null` means "not decided yet" — at least one directory has not been probed, so the game stays
 * visible instead of flickering out of the list during startup. A game that points at no
 * directory at all counts as missing: there is nothing on disk to launch.
 */
export function isGameMissingFromLibrary(
  gameId: string,
  gameDirectories: Record<string, string[]>,
  paths: Record<string, GamePathInfo>
): boolean | null {
  const directories = gameDirectories[gameId]
  if (!directories || directories.length === 0) return true

  let pending = false

  for (const directory of directories) {
    const valid = paths[directory]?.valid
    if (valid === true) return false
    if (valid === null || valid === undefined) pending = true
  }

  return pending ? null : true
}

export const useGamePathStore = create<GamePathStore>((set, get) => {
  /**
   * Probe a batch of paths and store the answers in one update.
   *
   * Batching matters: a single `set` per path would re-run every `paths` subscriber (library
   * filtering, every visible `GameNav`) once per path, and this store now holds one entry per
   * version directory as well.
   */
  const probe = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return

    const results: boolean[] = (await ipcManager.invoke('system:check-if-path-exist', paths)) ?? []
    if (results.length === 0) return

    const checkedAt = Date.now()
    set((state) => {
      const nextPaths = { ...state.paths }
      paths.forEach((path, idx) => {
        if (idx >= results.length) return
        nextPaths[path] = { valid: results[idx], lastChecked: checkedAt }
      })
      return { paths: nextPaths }
    })
  }

  return {
    paths: {},
    gameDirectories: {},

    addPaths: (paths) => {
      const newPaths: Record<string, GamePathInfo> = {}
      paths.forEach((p) => {
        if (!p) return
        newPaths[p] = { valid: null }
      })
      set((state) => ({
        paths: { ...newPaths, ...state.paths }
      }))
    },

    setGameDirectories: (gameId, directories) =>
      set((state) => ({
        gameDirectories: { ...state.gameDirectories, [gameId]: directories }
      })),

    removeGameDirectories: (gameId) =>
      set((state) => {
        if (!(gameId in state.gameDirectories)) return state
        const nextDirectories = { ...state.gameDirectories }
        delete nextDirectories[gameId]
        return { gameDirectories: nextDirectories }
      }),

    setValidity: (path, valid) =>
      set((state) => ({
        paths: {
          ...state.paths,
          [path]: { valid, lastChecked: Date.now() }
        }
      })),

    verifyAll: async () => {
      const uncheckedPaths = Object.entries(get().paths)
        .filter(([, info]) => info.valid === null)
        .map(([path]) => path)

      await probe(uncheckedPaths)
    },

    /**
     * Re-probe every known path, including ones that were already resolved.
     *
     * Existence is otherwise only ever checked once per session, so a game whose folder was moved
     * or deleted while the app was running would keep its stale verdict until a restart. Run after
     * a scan to pick those up.
     */
    recheckAll: async () => {
      await probe(Object.keys(get().paths))
    },

    requestValidity: async (path: string) => {
      const info = get().paths[path]

      if (!info || info.valid === null) {
        get().addPaths([path])
        await get().verifyAll()
      }
    },

    clear: () => set({ paths: {}, gameDirectories: {} })
  }
})
