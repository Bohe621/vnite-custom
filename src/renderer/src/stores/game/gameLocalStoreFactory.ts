import { DEFAULT_GAME_LOCAL_VALUES, type gameLocalDoc } from '@appTypes/models'
import {
  applyActiveVersionMirror,
  createVersionBlock,
  deepClone,
  generateUUID,
  getValueByPath,
  isVersionScopedPath,
  normalizeDirectoryForStorage,
  normalizeDirectoryKey,
  normalizeGameLocalDoc,
  setValueByPath,
  stripVersionPath,
  toVersionPath,
  versionDirectory
} from '@appUtils'
import type { Get, Paths } from 'type-fest'
import { create, StoreApi, UseBoundStore } from 'zustand'
import { syncTo } from '../utils'
import { useGameRegistry } from './gameRegistry'
import { useGamePathStore } from './gamePathStore'

// 单个游戏本地 store 的类型定义
export interface SingleGameLocalState {
  data: gameLocalDoc | null
  initialized: boolean

  getValue: <Path extends Paths<gameLocalDoc, { bracketNotation: true }>>(
    path: Path
  ) => Get<gameLocalDoc, Path>

  setValue: <Path extends Paths<gameLocalDoc, { bracketNotation: true }>>(
    path: Path,
    value: Get<gameLocalDoc, Path>
  ) => Promise<void>

  /** 与 getValue 相同，但接受任意字符串路径（多版本会拼出 `versions.<id>.*`，无法静态推导）。 */
  getValueByString: (path: string) => any

  /** 与 setValue 相同，但接受任意字符串路径。写入后自动维护顶层版本镜像。 */
  setValueByString: (path: string, value: any) => Promise<void>

  initialize: (data: gameLocalDoc, options?: { verifyPaths?: boolean }) => void

  getData: () => gameLocalDoc | null

  // 多版本
  createVersion: (name: string) => Promise<string>
  renameVersion: (versionId: string, name: string) => Promise<void>
  deleteVersion: (versionId: string) => Promise<void>
  setCurrentVersion: (versionId: string) => Promise<void>
}

type GameLocalStore = UseBoundStore<StoreApi<SingleGameLocalState>>

const gameLocalStores: Record<string, GameLocalStore> = {}

/**
 * Every directory this document's versions point at, de-duplicated (folders that differ only in
 * case / trailing separator count as one, so each is probed once). A version with no path is
 * skipped; an empty result means "the game points at no directory at all".
 */
function collectVersionDirectories(doc: gameLocalDoc | null): string[] {
  if (!doc) return []

  const directories: string[] = []
  const seen = new Set<string>()

  for (const version of Object.values(doc.versions ?? {})) {
    const directory = normalizeDirectoryForStorage(versionDirectory(version))
    const key = normalizeDirectoryKey(directory)
    if (!directory || seen.has(key)) continue
    seen.add(key)
    directories.push(directory)
  }

  return directories
}

/**
 * Publish a game's version directories to the path store.
 *
 * The store only ever probes paths it does not know yet, so calling this on every commit is cheap
 * after the first one; `verifyAll` resolves the freshly added `null` entries.
 */
function publishVersionDirectories(gameId: string, doc: gameLocalDoc | null): void {
  const directories = collectVersionDirectories(doc)
  useGamePathStore.getState().setGameDirectories(gameId, directories)
  if (directories.length > 0) {
    useGamePathStore.getState().addPaths(directories)
  }
}

/**
 * Resolve a value from a document, falling back to the defaults of the *unversioned* path.
 * A freshly created version block therefore behaves exactly like a legacy single-version
 * document until the user edits it.
 */
function resolveValue(data: gameLocalDoc | null, path: string): any {
  if (data) {
    const value = getValueByPath(data, path)
    if (value !== undefined) return value
  }
  return getValueByPath(DEFAULT_GAME_LOCAL_VALUES, stripVersionPath(path) ?? path)
}

export function getGameLocalStore(gameId: string): GameLocalStore {
  if (!gameLocalStores[gameId]) {
    gameLocalStores[gameId] = create<SingleGameLocalState>((set, get) => {
      /**
       * Write a mutated draft back: refresh the top-level mirror, push it to the DB and keep the
       * game registry / path validity store in sync with the (possibly new) launch path.
       */
      const commit = async (draft: gameLocalDoc, previousMirrorPath: string): Promise<void> => {
        applyActiveVersionMirror(draft)
        set({ data: draft })

        const mirrorPath = draft.path?.gamePath || ''
        if (mirrorPath !== previousMirrorPath) {
          useGameRegistry.getState().updateGameMeta(gameId, { gamePath: mirrorPath })
          if (mirrorPath) {
            useGamePathStore.getState().addPaths([mirrorPath])
          }
        }

        // Any write can add, retarget or drop a version, so the directory set is re-derived from
        // the document rather than patched.
        publishVersionDirectories(gameId, draft)
        void useGamePathStore.getState().verifyAll()

        await syncTo('game-local', gameId, draft)
      }

      const mutableData = (
        path: string,
        value: any
      ): { draft: gameLocalDoc; previous: string } | null => {
        const current = get().data
        if (!get().initialized || !current) {
          console.warn(
            `[Store] game local store ${gameId} is not initialized, ignoring write to ${path}`
          )
          return null
        }
        const currentValue = getValueByPath(current, path)
        if (JSON.stringify(currentValue) === JSON.stringify(value)) return null
        return { draft: deepClone(current), previous: current.path?.gamePath || '' }
      }

      return {
        data: null,
        initialized: false,

        getValue: <Path extends Paths<gameLocalDoc, { bracketNotation: true }>>(
          path: Path
        ): Get<gameLocalDoc, Path> => resolveValue(get().data, path as string),

        getValueByString: (path: string): any => resolveValue(get().data, path),

        setValue: async <Path extends Paths<gameLocalDoc, { bracketNotation: true }>>(
          path: Path,
          value: Get<gameLocalDoc, Path>
        ): Promise<void> => {
          await get().setValueByString(path as string, value)
        },

        setValueByString: async (path: string, value: any): Promise<void> => {
          const context = mutableData(path, value)
          if (!context) return
          const { draft, previous } = context

          setValueByPath(draft, path, value)

          // Writing a top-level path edits the launch version, so keep its block in step —
          // otherwise the mirror would immediately discard the write.
          if (isVersionScopedPath(path) && draft.currentVersionId) {
            setValueByPath(draft, toVersionPath(path, draft.currentVersionId), value)
          }

          await commit(draft, previous)
        },

        initialize: (data: gameLocalDoc, options?: { verifyPaths?: boolean }): void => {
          const normalized = deepClone(data)
          normalizeGameLocalDoc(normalized)

          set({ data: normalized, initialized: true })
          useGameRegistry
            .getState()
            .updateGameMeta(gameId, { gamePath: normalized.path?.gamePath || '' })
          publishVersionDirectories(gameId, normalized)

          // Batch callers collect every game's paths first and probe them in a single request.
          if (options?.verifyPaths !== false) {
            void useGamePathStore.getState().verifyAll()
          }
        },

        getData: (): gameLocalDoc | null => get().data,

        createVersion: async (name: string): Promise<string> => {
          const current = get().data
          if (!current) throw new Error(`[Store] game local store ${gameId} is not initialized`)

          const draft = deepClone(current)
          const id = generateUUID()
          // A new copy almost always starts from the one the user already configured.
          draft.versions[id] = createVersionBlock(id, name, draft.versions[draft.currentVersionId])
          await commit(draft, current.path?.gamePath || '')
          return id
        },

        renameVersion: async (versionId: string, name: string): Promise<void> => {
          const current = get().data
          if (!current?.versions[versionId] || current.versions[versionId].name === name) return
          const draft = deepClone(current)
          draft.versions[versionId].name = name
          await commit(draft, current.path?.gamePath || '')
        },

        deleteVersion: async (versionId: string): Promise<void> => {
          const current = get().data
          if (!current?.versions[versionId]) return
          if (Object.keys(current.versions).length <= 1) {
            throw new Error('[Store] at least one version must remain')
          }
          const draft = deepClone(current)
          delete draft.versions[versionId]
          if (draft.currentVersionId === versionId) {
            draft.currentVersionId = Object.keys(draft.versions)[0]
          }
          await commit(draft, current.path?.gamePath || '')
        },

        setCurrentVersion: async (versionId: string): Promise<void> => {
          const current = get().data
          if (!current?.versions[versionId] || current.currentVersionId === versionId) return
          const draft = deepClone(current)
          draft.currentVersionId = versionId
          await commit(draft, current.path?.gamePath || '')
        }
      }
    })
  }

  return gameLocalStores[gameId]
}

/**
 * Batch initialize game local store
 */
export async function initializeGameLocalStores(
  documents: Record<string, gameLocalDoc>,
  options?: {
    awaitPathValidity?: boolean
  }
): Promise<void> {
  Object.entries(documents).forEach(([gameId, gameData]) => {
    const store = getGameLocalStore(gameId)
    // Paths are collected first and probed in one request below instead of one per game.
    store.getState().initialize(gameData, { verifyPaths: false })
  })

  const gamePaths = Object.values(documents)
    .map((doc) => doc.path?.gamePath)
    .filter((p): p is string => !!p)
  useGamePathStore.getState().addPaths(gamePaths)

  const verifyPromise = useGamePathStore.getState().verifyAll()
  if (options?.awaitPathValidity) {
    await verifyPromise
  }
}

export function deleteGameLocalStore(gameId: string): void {
  if (gameLocalStores[gameId]) {
    delete gameLocalStores[gameId]
    console.log(`[Store] game local store ${gameId} deleted`)
  }
  useGamePathStore.getState().removeGameDirectories(gameId)
}
