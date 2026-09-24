/**
 * Storage and shared plumbing for the path conflicts raised by the scanner's identity fallback.
 *
 * Conflicts live in the local (unsynced) config rather than in the game databases: they describe
 * directories on *this* machine, so syncing them to another device would only produce noise.
 *
 * Resolving them is the version-conflict workbench's job (`versionReview.ts`); what stays here is
 * the record store, the version lookup the scanner routes folders with, the silent-adopt path, and
 * the two filesystem helpers both need.
 */
import {
  applyActiveVersionMirror,
  findVersionByLabel,
  generateUUID,
  getPrimaryVersionId,
  normalizeGameLocalDoc,
  versionDirectory
} from '@appUtils'
import type { PathConflict } from '@appTypes/utils'
import * as fse from 'fs-extra'
import * as path from 'path'
import { ConfigDBManager, GameDBManager } from '~/core/database'
import { inferRootPath, walkFs } from '~/utils'

const CONFLICTS_CONFIG_KEY = 'game.pathConflicts'

/** Everything the scanner knows about a conflict once it has decided it cannot resolve it. */
export type PathConflictInput = Omit<PathConflict, 'id' | 'createdAt'>

export async function listPathConflicts(): Promise<PathConflict[]> {
  const stored = await ConfigDBManager.getConfigLocalValue(CONFLICTS_CONFIG_KEY)
  return Array.isArray(stored) ? stored : []
}

export async function writePathConflicts(conflicts: PathConflict[]): Promise<void> {
  await ConfigDBManager.setConfigLocalValue(CONFLICTS_CONFIG_KEY, conflicts)
}

/**
 * Record a conflict, de-duplicating on (game, version, new directory) so repeated scans of the same
 * folder do not pile up identical entries — the fresh details simply replace the stale ones.
 */
export async function recordPathConflict(input: PathConflictInput): Promise<PathConflict[]> {
  const conflicts = await listPathConflicts()
  const existing = conflicts.find(
    (conflict) =>
      conflict.gameId === input.gameId &&
      conflict.versionId === input.versionId &&
      conflict.newPath === input.newPath
  )

  if (existing) {
    existing.kind = input.kind
    existing.versionLabel = input.versionLabel
    existing.scrapedName = input.scrapedName
    existing.versionName = input.versionName
    existing.existingPath = input.existingPath
    existing.existingPathExists = input.existingPathExists
    existing.candidates = input.candidates
  } else {
    conflicts.push({
      ...input,
      id: generateUUID(),
      createdAt: new Date().toISOString()
    })
  }

  await writePathConflicts(conflicts)
  return conflicts
}

/**
 * Which version a scanned folder should be routed to, and whether that version's directory is
 * still on disk. A labelled folder (`Game v1.2`) prefers the version named `1.2`; an unlabelled
 * one falls back to the primary (`default`) slot.
 */
export async function resolveTargetVersion(
  gameId: string,
  versionLabel: string | null
): Promise<{
  versionId: string
  versionName: string
  /** True when the folder label did not match any existing version. */
  versionMissing: boolean
  directory: string
  directoryExists: boolean
} | null> {
  const doc = await GameDBManager.getExistingGameLocal(gameId)
  if (!doc) return null
  normalizeGameLocalDoc(doc)

  const matched = versionLabel ? findVersionByLabel(doc, versionLabel) : null
  const versionId = matched?.id ?? getPrimaryVersionId(doc)
  const version = doc.versions?.[versionId]
  if (!version) return null

  const directory = versionDirectory(version)
  return {
    versionId,
    versionName: version.name ?? '',
    versionMissing: Boolean(versionLabel) && !matched,
    directory,
    directoryExists: directory ? await fse.pathExists(directory) : false
  }
}

/**
 * Make a directory the home of one version: point `markPath`/`rootPath` at it and re-locate the
 * executable when the recorded one no longer exists.
 *
 * `renameVersionTo` is used when a labelled folder takes over the primary slot — the version keeps
 * its id but is shown under the label from the folder name (`1.2` instead of `默认版本`).
 */
export async function adoptScannedDirectory(params: {
  gameId: string
  versionId: string
  directory: string
  renameVersionTo?: string
}): Promise<void> {
  const { gameId, versionId, directory, renameVersionTo } = params

  const doc = await GameDBManager.getExistingGameLocal(gameId)
  if (!doc) throw new Error(`Game not found: ${gameId}`)
  normalizeGameLocalDoc(doc)

  // The conflict may outlive the version it came from (the user can delete it in the properties
  // dialog), so fall back to the primary slot instead of failing.
  const targetVersionId = doc.versions?.[versionId] ? versionId : getPrimaryVersionId(doc)
  const version = doc.versions?.[targetVersionId]
  if (!version) throw new Error(`Game has no version to adopt a directory into: ${gameId}`)

  version.utils.markPath = directory
  version.utils.rootPath = inferRootPath(directory)
  version.path.gamePath = await relocateExecutable(version.path?.gamePath ?? '', directory)
  if (renameVersionTo) version.name = renameVersionTo

  applyActiveVersionMirror(doc)
  await GameDBManager.setGameLocal(gameId, doc)
}

/** Keep the recorded executable when it still exists, else look for a same-named file in the new folder. */
async function relocateExecutable(oldGamePath: string, directory: string): Promise<string> {
  if (!oldGamePath) return ''
  if (await fse.pathExists(oldGamePath)) return oldGamePath
  return (await findFileByName(directory, path.basename(oldGamePath))) ?? ''
}

export async function findFileByName(directory: string, fileName: string): Promise<string | null> {
  const target = fileName.toLowerCase()
  let found: string | null = null

  await walkFs(directory, {
    maxDepth: 4,
    // Executables only — a game folder can hold tens of thousands of asset files.
    filter: (name, _fullPath, isDir) =>
      isDir ? true : path.extname(name).toLowerCase() === '.exe',
    onFile: (fullPath) => {
      if (!found && path.basename(fullPath).toLowerCase() === target) found = fullPath
    }
  })

  return found
}

/**
 * Normalize a folder the way the scanner compares it: forward slashes, no trailing separator.
 * Mirrors the normalization in `GameScanner.applyIgnoreList` — the two must agree or a folder
 * written here would not actually be skipped there.
 */
export function normalizeIgnorePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Folders the scanner currently skips. */
export async function getScannerIgnoreList(): Promise<string[]> {
  const scannerConfig = await ConfigDBManager.getConfigLocalValue('game.scanner')
  return (scannerConfig?.ignoreList ?? []).filter((entry) => entry.trim().length > 0)
}

/** Write the ignore list back without touching the rest of the scanner config. */
async function writeScannerIgnoreList(next: string[]): Promise<void> {
  const scannerConfig = await ConfigDBManager.getConfigLocalValue('game.scanner')
  await ConfigDBManager.setConfigLocalValue('game.scanner', {
    ...scannerConfig,
    ignoreList: next
  })
}

/** Add a folder to the scanner ignore list so future scans stop re-reporting it. */
export async function addToScannerIgnoreList(directory: string): Promise<void> {
  const target = normalizeIgnorePath(directory)
  if (!target) return

  const current = (await getScannerIgnoreList()).map(normalizeIgnorePath)
  if (current.includes(target)) return
  await writeScannerIgnoreList(Array.from(new Set([...current, target])).sort())
}

/** Remove a folder from the ignore list, so the next scan reports it again. */
export async function removeFromScannerIgnoreList(directory: string): Promise<void> {
  const target = normalizeIgnorePath(directory)
  if (!target) return

  const current = (await getScannerIgnoreList()).map(normalizeIgnorePath)
  const next = current.filter((entry) => entry !== target)
  if (next.length === current.length) return
  await writeScannerIgnoreList(next)
}

/*
 * Resolving a conflict is the version-conflict workbench's job (`versionReview.ts`), not this
 * module's: the user edits a game's whole version list at once and commits it with one save, so
 * there is no per-conflict action table here any more — only the storage the scanner writes to and
 * the workbench reads from.
 */
