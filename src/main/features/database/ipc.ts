import {
  backupDatabase,
  restoreDatabase,
  startSync,
  stopSync,
  fullSync,
  getCouchDBSize,
  compactRemoteDatabase,
  resetAppearancesSettings,
  getLocalStorageReport,
  getGameStorageDetail,
  removeGameImageAttachment
} from './services'
import { baseDBManager, ConfigDBManager, GameDBManager } from '~/core/database'
import { ipcManager } from '~/core/ipc'
import { DocChange, gameLocalDoc } from '@appTypes/models'
import { applyActiveVersionMirror, normalizeGameLocalDoc } from '@appUtils'
import { shouldReinferRootPath } from '~/utils'

export function setupDatabaseIPC(): void {
  ipcManager.handle('db:doc-changed', async (_event, change: DocChange) => {
    if (change.dbName !== 'game-local' || !change.data || change.data === '#delete') {
      return await baseDBManager.setValue(change.dbName, change.docId, '#all', change.data)
    }

    const stored = await GameDBManager.getExistingGameLocal(change.docId)
    const incoming = change.data as Partial<gameLocalDoc>

    // Merge against what is already stored instead of against the incoming payload. A partial
    // payload used to replace whole sub-objects (`path`, `utils`, …) and silently drop the
    // sibling fields it did not mention. `versions` stays authoritative from the payload so a
    // deleted version is really deleted.
    const next = {
      ...(stored ?? {}),
      ...incoming,
      path: { ...(stored?.path ?? {}), ...(incoming.path ?? {}) },
      launcher: {
        ...(stored?.launcher ?? {}),
        ...(incoming.launcher ?? {}),
        fileConfig: {
          ...(stored?.launcher?.fileConfig ?? {}),
          ...(incoming.launcher?.fileConfig ?? {})
        },
        urlConfig: {
          ...(stored?.launcher?.urlConfig ?? {}),
          ...(incoming.launcher?.urlConfig ?? {})
        },
        scriptConfig: {
          ...(stored?.launcher?.scriptConfig ?? {}),
          ...(incoming.launcher?.scriptConfig ?? {})
        }
      },
      utils: { ...(stored?.utils ?? {}), ...(incoming.utils ?? {}) },
      versions: incoming.versions ?? stored?.versions ?? {}
    } as gameLocalDoc

    normalizeGameLocalDoc(next)

    // Keep rootPath consistent with the launch version's gamePath. Compared against the stored
    // document, not against the payload.
    const activeVersion = next.versions[next.currentVersionId]
    const activeGamePath = activeVersion?.path?.gamePath ?? ''
    if (activeGamePath) {
      const previousGamePath =
        stored?.versions?.[stored.currentVersionId]?.path?.gamePath ?? stored?.path?.gamePath ?? ''
      const newRootPath = shouldReinferRootPath(
        previousGamePath,
        activeGamePath,
        activeVersion.utils?.rootPath ?? ''
      )
      if (newRootPath !== null) {
        activeVersion.utils.rootPath = newRootPath
        applyActiveVersionMirror(next)
      }
    }

    return await baseDBManager.setValue(change.dbName, change.docId, '#all', next)
  })

  ipcManager.handle('db:get-all-docs', async (_event, dbName: string) => {
    return await baseDBManager.getAllDocs(dbName)
  })

  ipcManager.handle('db:get-local-storage-report', async () => {
    return await getLocalStorageReport()
  })

  ipcManager.handle('db:get-game-storage-detail', async (_, gameId: string) => {
    return await getGameStorageDetail(gameId)
  })

  ipcManager.handle('db:restart-sync', async (_) => {
    await startSync()
  })

  ipcManager.handle('db:full-sync', async (_) => {
    await fullSync()
  })

  ipcManager.handle('db:stop-sync', async (_) => {
    stopSync()
  })

  ipcManager.handle(
    'db:check-attachment',
    async (_event, dbName: string, docId: string, attachmentId: string) => {
      return await baseDBManager.checkAttachment(dbName, docId, attachmentId)
    }
  )

  ipcManager.handle('db:backup', async (_, targetPath: string) => {
    await backupDatabase(targetPath)
  })

  ipcManager.handle('db:restore', async (_, sourcePath: string) => {
    await restoreDatabase(sourcePath)
  })

  ipcManager.handle('db:get-couchdb-size', async (_, refreshCache?: boolean) => {
    const username = await ConfigDBManager.getConfigLocalValue('sync.officialConfig.auth.username')
    return await getCouchDBSize(username, refreshCache)
  })

  ipcManager.handle(
    'db:set-config-background',
    async (_, path: string, theme: 'dark' | 'light') => {
      return await ConfigDBManager.setConfigBackgroundImage(path, theme)
    }
  )

  ipcManager.handle('db:remove-config-background', async (_, theme: 'dark' | 'light' | '#all') => {
    return await ConfigDBManager.removeConfigBackgroundImage(theme)
  })

  ipcManager.handle('db:compact-remote-database', async (_) => {
    const username = await ConfigDBManager.getConfigLocalValue('sync.officialConfig.auth.username')
    await compactRemoteDatabase(username)
  })

  ipcManager.handle('db:reset-appearances-settings', async () => {
    await resetAppearancesSettings()
  })

  ipcManager.handle(
    'db:remove-game-attachment',
    async (_, gameId: string, attachmentId: string) => {
      await removeGameImageAttachment(gameId, attachmentId)
    }
  )
}
