import {
  GameImageUpscaleOptions,
  GameMetadataField,
  GameMetadataUpdateMode,
  GameMetadataUpdateOptions,
  VersionReviewSavePayload
} from '@appTypes/utils'
import { ipcManager } from '~/core/ipc'
import {
  addGameToDB,
  addGameToDBWithoutMetadata,
  batchUpdateGameMetadata,
  checkVersionPaths,
  clearVersionRecords,
  getBatchGameAdderData,
  getVersionRecord,
  getVersionReview,
  listVersionReviews,
  refreshVersionReview,
  removeVersionRecord,
  saveVersionReview,
  updateGameMetadata
} from './services'

export function setupAdderIPC(): void {
  ipcManager.handle(
    'adder:add-game-to-db',
    async (
      _,
      {
        dataSource,
        dataSourceId,
        backgroundUrl,
        upscaleEnabled,
        upscaleOptionsOverride,
        dirPath,
        gamePath
      }: {
        dataSource: string
        dataSourceId: string
        backgroundUrl?: string
        upscaleEnabled?: boolean
        upscaleOptionsOverride?: GameImageUpscaleOptions
        dirPath?: string
        gamePath?: string
      }
    ) => {
      await addGameToDB({
        dataSource,
        dataSourceId,
        backgroundUrl,
        upscaleEnabled,
        upscaleOptionsOverride,
        dirPath,
        gamePath
      })
    }
  )

  ipcManager.handle(
    'adder:update-game-metadata',
    async (
      _,
      {
        dbId,
        dataSource,
        dataSourceId,
        fields,
        backgroundUrl,
        upscaleEnabled,
        upscaleOptionsOverride,
        options
      }: {
        dbId: string
        dataSource: string
        dataSourceId: string
        fields?: (GameMetadataField | GameMetadataUpdateMode)[]
        backgroundUrl?: string
        upscaleEnabled?: boolean
        upscaleOptionsOverride?: GameImageUpscaleOptions
        options?: GameMetadataUpdateOptions
      }
    ) => {
      await updateGameMetadata({
        dbId,
        dataSource,
        dataSourceId,
        fields,
        backgroundUrl,
        upscaleEnabled,
        upscaleOptionsOverride,
        options
      })
    }
  )

  ipcManager.handle('adder:get-batch-game-adder-data', async () => {
    return await getBatchGameAdderData()
  })

  ipcManager.handle(
    'adder:add-game-to-db-without-metadata',
    async (_, dirPath: string, gamePath: string) => {
      await addGameToDBWithoutMetadata(dirPath, gamePath)
    }
  )

  ipcManager.handle(
    'adder:batch-update-game-metadata',
    async (
      _,
      {
        gameIds,
        dataSource,
        fields,
        upscaleEnabled,
        upscaleOptionsOverride,
        options,
        concurrency
      }: {
        gameIds: string[]
        dataSource: string
        fields?: (GameMetadataField | GameMetadataUpdateMode)[]
        upscaleEnabled?: boolean
        upscaleOptionsOverride?: GameImageUpscaleOptions
        options?: GameMetadataUpdateOptions
        concurrency?: number
      }
    ) => {
      await batchUpdateGameMetadata({
        gameIds,
        dataSource,
        fields,
        upscaleEnabled,
        upscaleOptionsOverride,
        options,
        concurrency
      })
    }
  )

  // Version-conflict workbench: scanned folders + duplicate library entries, edited per game.
  ipcManager.handle('version-review:list', async () => {
    return await listVersionReviews()
  })

  ipcManager.handle('version-review:get', async (_, gameId: string) => {
    return await getVersionReview(gameId)
  })

  ipcManager.handle('version-review:save', async (_, payload: VersionReviewSavePayload) => {
    return await saveVersionReview(payload)
  })

  ipcManager.handle('version-review:check-paths', async (_, paths: string[]) => {
    return await checkVersionPaths(paths)
  })

  ipcManager.handle('version-review:refresh', async (_, gameId: string) => {
    return await refreshVersionReview(gameId)
  })

  // Processing log: what the workbench did to a game, shown in its properties dialog.
  ipcManager.handle('version-review:get-record', async (_, gameId: string) => {
    return await getVersionRecord(gameId)
  })

  ipcManager.handle('version-review:remove-record', async (_, gameId: string, entryId: string) => {
    return await removeVersionRecord(gameId, entryId)
  })

  ipcManager.handle('version-review:clear-records', async (_, gameId: string) => {
    return await clearVersionRecords(gameId)
  })
}
