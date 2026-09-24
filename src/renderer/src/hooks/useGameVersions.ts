import { createContext, useCallback, useContext } from 'react'
import { useStore } from 'zustand'
import type { GameLocalVersion, gameLocalDoc } from '@appTypes/models'
import { isVersionScopedPath, toVersionPath } from '@appUtils'
import { getGameLocalStore } from '~/stores/game/gameLocalStoreFactory'

/**
 * While a version scope is active, every version-owned path read or written through
 * `useGameLocalState` is transparently addressed inside `versions.<id>.*` instead of the
 * top-level mirror.
 *
 * The launcher/path tabs of the properties dialog set this scope, so all of their fields follow
 * the version being edited — including fields inside nested components, which therefore cannot
 * be forgotten when a new one is added.
 */
export const GameVersionScope = createContext<string | null>(null)

export function useGameVersionScope(): string | null {
  return useContext(GameVersionScope)
}

/** Map a version-owned path onto the scoped version, leaving global paths untouched. */
export function scopePath(path: string, versionId: string | null): string {
  if (!versionId || !isVersionScopedPath(path)) return path
  return toVersionPath(path, versionId)
}

export interface GameVersionsApi {
  versions: GameLocalVersion[]
  currentVersionId: string
  setCurrentVersion: (versionId: string) => Promise<void>
  createVersion: (name: string) => Promise<string>
  renameVersion: (versionId: string, name: string) => Promise<void>
  deleteVersion: (versionId: string) => Promise<void>
}

/** Reactive list of a game's versions plus the operations the version selectors drive. */
export function useGameVersions(gameId: string): GameVersionsApi {
  const gameLocalStore = getGameLocalStore(gameId)
  const data = useStore(gameLocalStore, (state) => state.data as gameLocalDoc | null)

  const versions = data?.versions ? Object.values(data.versions) : []
  const currentVersionId = data?.currentVersionId ?? ''

  const setCurrentVersion = useCallback(
    (versionId: string) => gameLocalStore.getState().setCurrentVersion(versionId),
    [gameLocalStore]
  )
  const createVersion = useCallback(
    (name: string) => gameLocalStore.getState().createVersion(name),
    [gameLocalStore]
  )
  const renameVersion = useCallback(
    (versionId: string, name: string) => gameLocalStore.getState().renameVersion(versionId, name),
    [gameLocalStore]
  )
  const deleteVersion = useCallback(
    (versionId: string) => gameLocalStore.getState().deleteVersion(versionId),
    [gameLocalStore]
  )

  return {
    versions,
    currentVersionId,
    setCurrentVersion,
    createVersion,
    renameVersion,
    deleteVersion
  }
}
