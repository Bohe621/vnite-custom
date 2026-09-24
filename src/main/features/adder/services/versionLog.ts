/**
 * Processing log for the version workbench.
 *
 * The workbench makes three kinds of changes, and the user asked to be able to look at them later:
 * folders it was told to ignore, folders it adopted as versions, and duplicate entries it merged
 * away. The ignored folders are the only ones worth listing for a second reason — they are the only
 * reversible action, and undoing one has to also undo its effect on the scanner's ignore list, which
 * is why both live here rather than in the UI.
 *
 * Stored in the local (unsynced) config, next to `pathConflicts`: the entries describe folders on
 * this machine.
 */
import type {
  VersionReviewLogAction,
  VersionReviewLogEntry,
  VersionReviewLogItem,
  VersionReviewRecord,
  VersionReviewRecordResult
} from '@appTypes/utils'
import { generateUUID } from '@appUtils'
import { ConfigDBManager } from '~/core/database'
import {
  getScannerIgnoreList,
  normalizeIgnorePath,
  removeFromScannerIgnoreList
} from './pathConflicts'

/** Newest entries are kept; these caps only stop a long-lived library from growing forever. */
const MAX_ENTRIES_PER_GAME = 100
const MAX_TOTAL_ENTRIES = 2000

/** What a caller describes; id and timestamp are filled in here. */
export type VersionLogInput = Omit<VersionReviewLogEntry, 'id' | 'at'> & { at?: string }

/** Stamp an entry with id and time, so callers only describe what happened. */
export function createLogEntry(input: VersionLogInput): VersionReviewLogEntry {
  return { ...input, id: generateUUID(), at: input.at ?? new Date().toISOString() }
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

/** Read-modify-write races would drop entries, and a save can emit several entries at once. */
let writeQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task)
  writeQueue = run.catch(() => undefined)
  return run
}

async function readLog(): Promise<VersionReviewLogEntry[]> {
  const stored = await ConfigDBManager.getConfigLocalValue('game.versionLog')
  // The default value is a module-level array — copy before anyone mutates it.
  return Array.isArray(stored) ? stored.map((entry) => ({ ...entry })) : []
}

async function writeLog(entries: VersionReviewLogEntry[]): Promise<void> {
  await ConfigDBManager.setConfigLocalValue('game.versionLog', trim(entries))
}

/** Keep the newest entries per game and overall, oldest first. */
function trim(entries: VersionReviewLogEntry[]): VersionReviewLogEntry[] {
  const ordered = [...entries].sort((a, b) => a.at.localeCompare(b.at))

  const perGame = new Map<string, VersionReviewLogEntry[]>()
  for (const entry of ordered) {
    const list = perGame.get(entry.gameId) ?? []
    list.push(entry)
    perGame.set(entry.gameId, list)
  }

  const kept: VersionReviewLogEntry[] = []
  for (const list of perGame.values()) {
    kept.push(...list.slice(Math.max(0, list.length - MAX_ENTRIES_PER_GAME)))
  }

  kept.sort((a, b) => a.at.localeCompare(b.at))
  return kept.slice(Math.max(0, kept.length - MAX_TOTAL_ENTRIES))
}

/** Append what just happened. Failures are logged and swallowed: never fail a save over a log. */
export async function appendVersionLog(inputs: VersionLogInput[]): Promise<void> {
  if (inputs.length === 0) return
  try {
    await enqueue(async () => {
      const log = await readLog()
      log.push(...inputs.map(createLogEntry))
      await writeLog(log)
    })
  } catch (error) {
    console.warn('[VersionLog] Failed to append entries:', error)
  }
}

/**
 * Move a deleted entry's history onto the entry that absorbed it, so merging does not erase what
 * was done to the game beforehand.
 */
export async function reKeyVersionLog(fromGameId: string, toGameId: string): Promise<void> {
  if (!fromGameId || !toGameId || fromGameId === toGameId) return
  try {
    await enqueue(async () => {
      const log = await readLog()
      let changed = false
      for (const entry of log) {
        if (entry.gameId === fromGameId) {
          entry.gameId = toGameId
          changed = true
        }
      }
      if (changed) await writeLog(log)
    })
  } catch (error) {
    console.warn('[VersionLog] Failed to re-key entries:', error)
  }
}

// ---------------------------------------------------------------------------------------------
// Reading / undoing
// ---------------------------------------------------------------------------------------------

async function buildRecord(gameId: string): Promise<VersionReviewRecord> {
  const [log, ignoreList] = await Promise.all([readLog(), getScannerIgnoreList()])
  const ignored = new Set(ignoreList.map(normalizeIgnorePath))

  const items: VersionReviewLogItem[] = log
    .filter((entry) => entry.gameId === gameId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((entry) => {
      const isIgnore = entry.action === 'ignore-folder'
      return {
        ...entry,
        revertible: isIgnore,
        active: isIgnore && !!entry.directory && ignored.has(normalizeIgnorePath(entry.directory))
      }
    })

  return { gameId, items }
}

export async function getVersionRecord(gameId: string): Promise<VersionReviewRecord> {
  return await buildRecord(gameId)
}

/** Drop one entry. Ignoring a folder is undone as a side effect: the folder is un-ignored. */
export async function removeVersionRecord(
  gameId: string,
  entryId: string
): Promise<VersionReviewRecordResult> {
  const fail = async (error: string): Promise<VersionReviewRecordResult> => ({
    success: false,
    error,
    record: await buildRecord(gameId)
  })

  try {
    let missing = false
    let directory: string | undefined

    await enqueue(async () => {
      const log = await readLog()
      const index = log.findIndex((entry) => entry.id === entryId && entry.gameId === gameId)
      if (index === -1) {
        missing = true
        return
      }
      if (log[index].action === 'ignore-folder') directory = log[index].directory
      log.splice(index, 1)
      await writeLog(log)
    })

    if (missing) return await fail(`Record not found: ${entryId}`)
    if (directory) await removeFromScannerIgnoreList(directory)
    return { success: true, record: await buildRecord(gameId) }
  } catch (error) {
    return await fail(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Drop every ignored-folder entry of one game, un-ignoring the folders that were being skipped.
 *
 * Merges and adoptions are history, not settings — the button lives inside the ignored-folders card
 * and must not take them with it. They can be removed one by one instead.
 */
export async function clearVersionRecords(gameId: string): Promise<VersionReviewRecordResult> {
  try {
    let directories: string[] = []

    await enqueue(async () => {
      const log = await readLog()
      const isIgnoredFolder = (entry: VersionReviewLogEntry): boolean =>
        entry.gameId === gameId && entry.action === 'ignore-folder'

      directories = log
        .filter(isIgnoredFolder)
        .map((entry) => entry.directory ?? '')
        .filter((directory) => directory.length > 0)

      await writeLog(log.filter((entry) => !isIgnoredFolder(entry)))
    })

    for (const directory of Array.from(new Set(directories))) {
      await removeFromScannerIgnoreList(directory)
    }

    return { success: true, record: await buildRecord(gameId) }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      record: await buildRecord(gameId)
    }
  }
}

/** Convenience for callers that build entries inline. */
export function isReversible(action: VersionReviewLogAction): boolean {
  return action === 'ignore-folder'
}
