/**
 * The version-conflict workbench, main-process side.
 *
 * Facts about a game's versions are spread over two places: the local documents (`versions`, one
 * per library entry) and the scan conflicts recorded in `game.pathConflicts`. The workbench shows
 * both as one editable version list per game, and commits the whole list with a single save.
 *
 * Two problems are folded into the same list because the fix is the same:
 *
 * - **Duplicate library entries.** Entries that share a provider id are the same product, and the
 *   user wants one entry with several versions. Grouping is by id and never by title: two different
 *   games can easily share a name, and merging them would be unrecoverable.
 * - **Scanned folders waiting for a decision.** `pathConflicts.ts` refuses to guess when a folder
 *   could belong to several games or when the recorded directory is still there, so those records
 *   become "incoming" rows the user can adopt as a version or reject.
 *
 * Nothing is written until `saveVersionReview` runs, and every failure leaves the stored data
 * untouched.
 */
import {
  applyActiveVersionMirror,
  createVersionBlock,
  DEFAULT_VERSION_ID,
  deepClone,
  generateUUID,
  getPrimaryVersionId,
  listVersions,
  normalizeDirectoryForStorage,
  normalizeDirectoryKey,
  normalizeGameLocalDoc,
  parseVersionSuffix,
  versionDirectory
} from '@appUtils'
import type { GameLocalVersionMap, gameDoc, gameLocalDoc } from '@appTypes/models'
import type {
  PathConflict,
  VersionReviewDetail,
  VersionReviewIncoming,
  VersionReviewReason,
  VersionReviewRefreshResult,
  VersionReviewSavePayload,
  VersionReviewSaveResult,
  VersionReviewSummary,
  VersionReviewVersion
} from '@appTypes/utils'
import log from 'electron-log/main'
import * as fse from 'fs-extra'
import * as path from 'path'
import { GameDBManager } from '~/core/database'
import { ipcManager } from '~/core/ipc'
import { inferRootPath } from '~/utils'
import {
  addToScannerIgnoreList,
  findFileByName,
  listPathConflicts,
  writePathConflicts
} from './pathConflicts'
import { appendVersionLog, reKeyVersionLog, type VersionLogInput } from './versionLog'

/**
 * Provider-specific id fields a game document may carry inside `metadata`. The game model types
 * only the ones with a fixed field; the rest arrive from the scrapers under their own key.
 */
const SOURCE_ID_FIELDS = [
  'dlsiteId',
  'steamId',
  'vndbId',
  'igdbId',
  'ymgalId',
  'bangumiId'
] as const

interface GameEntry {
  gameId: string
  title: string
  /** `record.addDate`, used to break ties when choosing which entry survives a merge. */
  addDate: string
  local: gameLocalDoc
  /**
   * Whether any of the entry's directories is still on disk. Entries are only probed once they are
   * in a group (`markLiveness`), so outside `buildGroups` this stays at the `false` that `toEntry`
   * sets — probing the whole library on every list would be needless disk work.
   */
  alive: boolean
}

interface ReviewGroup {
  /** Entries sharing an identity, primary first. */
  entries: GameEntry[]
  /** Scan conflicts that point at this group. */
  conflicts: PathConflict[]
}

// ---------------------------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------------------------

/**
 * Games whose version data needs attention, as lightweight summaries.
 *
 * Directory probes are the only slow part and they are needed just to decide which entry survives a
 * merge, so they are limited to entries inside a group (never the whole library).
 */
export async function listVersionReviews(): Promise<VersionReviewSummary[]> {
  const groups = await buildGroups()
  return groups
    .map((group) => summarise(group))
    .sort((a, b) => a.title.localeCompare(b.title) || a.gameId.localeCompare(b.gameId))
}

export async function getVersionReview(gameId: string): Promise<VersionReviewDetail | null> {
  const groups = await buildGroups()
  const group =
    groups.find((candidate) => candidate.entries[0].gameId === gameId) ??
    groups.find((candidate) => candidate.entries.some((entry) => entry.gameId === gameId))

  if (!group) return null

  const [primary, ...others] = group.entries
  const primaryIds = new Set(Object.keys(primary.local.versions ?? {}))

  const versions: VersionReviewVersion[] = []
  const namesTaken = new Set<string>()

  for (const entry of group.entries) {
    const entryDirectory = primaryDirectoryOf(entry.local)

    for (const version of listVersions(entry.local)) {
      const directory = versionDirectory(version)
      versions.push({
        id: version.id,
        name: claimVersionName(version.name, directory, namesTaken),
        path: directory,
        gamePath: version.path?.gamePath ?? '',
        originGameId: entry.gameId,
        originTitle: entry.title,
        originDirectory: entryDirectory,
        existing: primaryIds.has(version.id),
        pathExists: directory ? await fse.pathExists(directory) : false,
        status: 'ok'
      })
    }
  }

  markVersionConflicts(versions)

  const incoming: VersionReviewIncoming[] = group.conflicts.map((conflict) => ({
    conflictId: conflict.id,
    path: conflict.newPath,
    label: incomingLabel(conflict),
    targetVersionId: conflict.versionId,
    targetPath: conflict.existingPath,
    kind: conflict.kind
  }))

  return {
    gameId: primary.gameId,
    title: primary.title,
    reasons: reasonsFor(group),
    versions,
    incoming,
    mergeGameIds: others.map((entry) => entry.gameId),
    mergeTitles: others.map((entry) => entry.title)
  }
}

/**
 * Name to pre-fill for a scanned folder waiting to be adopted.
 *
 * The version marker in the folder name is the only label that says something about *this copy*
 * (`Game v1.2` → `1.2`). A folder without one is routed to the game's primary slot, so it is
 * offered under that slot's own id — `default`.
 *
 * The folder name is deliberately never used: it describes the directory, not the version, and the
 * whole point of the fallback is that there is no version to name. A long one would also fill the
 * whole input with text the user has to clear out first.
 *
 * The primary version's own name is not used either: this row becomes a *new* version alongside
 * it, so borrowing its name would leave the version selector showing two identically named entries
 * and no way to tell which is which.
 */
function incomingLabel(conflict: PathConflict): string {
  const label = (conflict.versionLabel ?? '').trim()
  if (label) return label
  return conflict.versionId || DEFAULT_VERSION_ID
}

/** Directory of an entry's primary version: the folder that identifies this copy on disk. */
function primaryDirectoryOf(doc: gameLocalDoc): string {
  return versionDirectory(doc.versions?.[getPrimaryVersionId(doc)])
}

/**
 * Name to show for a version row.
 *
 * An unnamed version borrows the version number at the end of its folder (`…ver1.001` → `1.001`),
 * falling back to the folder name. Rows that would end up with the same name get a numeric suffix —
 * which is the whole point of the exercise: after a merge the user has to be able to tell the two
 * copies apart in the version selector.
 */
function claimVersionName(rawName: string, directory: string, taken: Set<string>): string {
  const base = (rawName ?? '').trim() || suggestVersionName(directory)
  if (!base) return ''

  let name = base
  let index = 2
  while (taken.has(name.toLowerCase())) {
    name = `${base} (${index})`
    index += 1
  }

  taken.add(name.toLowerCase())
  return name
}

function suggestVersionName(directory: string): string {
  if (!directory) return ''
  const folder = path.basename(directory)
  return parseVersionSuffix(folder) ?? folder
}

/**
 * Paint the two problems the user has to fix: a row whose directory is gone, and rows that two or
 * more versions claim. Every member of a collision is flagged, not just the later ones — which of
 * them is "right" is exactly what the user is here to decide.
 */ function markVersionConflicts(versions: VersionReviewVersion[]): void {
  const byDirectory = new Map<string, VersionReviewVersion[]>()
  for (const version of versions) {
    const key = normalizeDirectoryKey(version.path)
    if (!key) continue
    const list = byDirectory.get(key) ?? []
    list.push(version)
    byDirectory.set(key, list)
  }

  for (const version of versions) {
    const key = normalizeDirectoryKey(version.path)
    const collisions = key ? (byDirectory.get(key) ?? []) : []
    if (collisions.length > 1) {
      version.status = 'duplicate'
      const other = collisions.find((candidate) => candidate !== version)
      version.duplicateOf = other ? `${other.originGameId}:${other.id}` : undefined
      continue
    }
    version.status = version.path && version.pathExists ? 'ok' : 'missing'
  }
}

function summarise(group: ReviewGroup): VersionReviewSummary {
  const primary = group.entries[0]
  return {
    gameId: primary.gameId,
    title: primary.title,
    reasons: reasonsFor(group),
    entryCount: group.entries.length,
    // Duplicates only: the primary is not one of them, and it can only be dead when every entry is
    // (see `orderWithPrimaryFirst`), which the editor shows row by row anyway.
    staleEntryCount: group.entries.slice(1).filter((entry) => !entry.alive).length,
    incomingCount: group.conflicts.length,
    versionCount: group.entries.reduce(
      (total, entry) => total + listVersions(entry.local).length,
      0
    )
  }
}

function reasonsFor(group: ReviewGroup): VersionReviewReason[] {
  const reasons: VersionReviewReason[] = []
  if (group.conflicts.length > 0) reasons.push('scan-conflict')
  if (group.entries.length > 1) reasons.push('duplicate-entries')
  return reasons
}

async function buildGroups(): Promise<ReviewGroup[]> {
  const [games, locals, conflicts] = await Promise.all([
    GameDBManager.getAllGames(),
    GameDBManager.getAllGamesLocal(),
    listPathConflicts()
  ])

  const entries = new Map<string, GameEntry>()
  for (const game of Object.values(games)) {
    const local = locals[game._id]
    if (!local) continue
    entries.set(game._id, toEntry(game, local))
  }

  const rootOf = createIdentityIndex(entries, games)

  const byRoot = new Map<string, GameEntry[]>()
  for (const entry of entries.values()) {
    const root = rootOf(entry.gameId)
    const list = byRoot.get(root) ?? []
    list.push(entry)
    byRoot.set(root, list)
  }

  const conflictsByRoot = new Map<string, PathConflict[]>()
  for (const conflict of conflicts) {
    // A conflict whose game has been deleted has nothing left to resolve.
    if (!entries.has(conflict.gameId)) continue
    const root = rootOf(conflict.gameId)
    const list = conflictsByRoot.get(root) ?? []
    list.push(conflict)
    conflictsByRoot.set(root, list)
  }

  const groups: ReviewGroup[] = []
  const settled: PathConflict[] = []

  for (const [root, groupEntries] of byRoot) {
    await markLiveness(groupEntries)
    const ordered = orderWithPrimaryFirst(groupEntries)
    const owned = ownedBy(ordered)

    // A folder that already *is* one of this game's versions has been decided: it was adopted
    // when the version was added (usually while merging the entry it used to belong to). Asking
    // about it again on every scan is what turned a one-off decision into a permanent reminder,
    // so it is dropped here instead of being offered as an "incoming" row.
    const groupConflicts = (conflictsByRoot.get(root) ?? []).filter((conflict) => {
      if (!owned.has(normalizeDirectoryKey(conflict.newPath))) return true
      settled.push(conflict)
      return false
    })

    if (ordered.length < 2 && groupConflicts.length === 0) continue
    groups.push({ entries: ordered, conflicts: groupConflicts })
  }

  if (settled.length > 0) {
    const settledIds = new Set(settled.map((conflict) => conflict.id))
    await writePathConflicts(conflicts.filter((conflict) => !settledIds.has(conflict.id)))
  }

  return groups
}

/** Every directory the group's entries already own. */
function ownedBy(entries: GameEntry[]): Set<string> {
  const owned = new Set<string>()
  for (const entry of entries) {
    for (const version of listVersions(entry.local)) {
      const key = normalizeDirectoryKey(versionDirectory(version))
      if (key) owned.add(key)
    }
  }
  return owned
}

function toEntry(game: gameDoc, local: gameLocalDoc): GameEntry {
  const doc = deepClone(local)
  normalizeGameLocalDoc(doc, {
    defaultVersionName: (game.metadata?.version ?? '').trim() || undefined
  })

  return {
    gameId: game._id,
    title: game.metadata?.name || game.metadata?.originalName || game._id,
    addDate: game.record?.addDate ?? '',
    local: doc,
    // Unknown until the entry lands in a group — see `markLiveness`.
    alive: false
  }
}

/**
 * Union-find over the provider ids in `metadata`: two entries that carry the same id for any
 * provider are the same product. Titles are deliberately ignored — see the module header.
 */
function createIdentityIndex(
  entries: Map<string, GameEntry>,
  games: { [gameId: string]: gameDoc }
): (gameId: string) => string {
  const parent = new Map<string, string>()
  for (const gameId of entries.keys()) parent.set(gameId, gameId)

  const find = (gameId: string): string => {
    let root = gameId
    while (parent.get(root) !== root) root = parent.get(root) as string
    // Path compression, so repeated lookups during grouping stay cheap.
    let cursor = gameId
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor) as string
      parent.set(cursor, root)
      cursor = next
    }
    return root
  }

  const union = (a: string, b: string): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootB, rootA)
  }

  const seen = new Map<string, string>()
  for (const gameId of entries.keys()) {
    const metadata = (games[gameId]?.metadata ?? {}) as unknown as Record<string, unknown>
    for (const field of SOURCE_ID_FIELDS) {
      const value = String(metadata[field] ?? '')
        .trim()
        .toLowerCase()
      if (!value) continue
      const key = `${field}:${value}`
      const first = seen.get(key)
      if (first) union(first, gameId)
      else seen.set(key, gameId)
    }
  }

  return find
}

/**
 * Probe a group's directories once, in place.
 *
 * Who survives a merge and how many duplicates are stale are two readings of the same fact, so the
 * disk is asked a single time per group and the answer is carried on the entries.
 */
async function markLiveness(entries: GameEntry[]): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      entry.alive = await hasReachableDirectory(entry.local)
    })
  )
}

/**
 * Pick the entry that survives a merge and put it first. Needs `markLiveness` to have run.
 *
 * A directory that is still on disk wins: that entry is the copy the user can actually launch, so
 * it keeps its id (and with it the launch history, collections and saves hanging off it). When none
 * or several qualify, the oldest entry wins, matching "the one I added first".
 */
function orderWithPrimaryFirst(candidates: GameEntry[]): GameEntry[] {
  const alive = candidates.filter((entry) => entry.alive)
  const pool = alive.length > 0 ? alive : candidates

  const primary = [...pool].sort(
    (a, b) => compareAddDate(a.addDate, b.addDate) || a.gameId.localeCompare(b.gameId)
  )[0]

  return [primary, ...candidates.filter((entry) => entry !== primary)]
}

/** Empty dates sort last, so an entry that predates `addDate` still wins the tie-break. */
function compareAddDate(a: string, b: string): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b)
}

/** Whether any of a game's versions still points at a directory on disk. */
async function hasReachableDirectory(doc: gameLocalDoc): Promise<boolean> {
  const versions = listVersions(doc)
  if (versions.length === 0) return false

  // The primary version first: it is the one the library launches, so it speaks for the entry.
  const primaryId = getPrimaryVersionId(doc)
  const ordered = [doc.versions?.[primaryId], ...versions].filter(
    (version): version is NonNullable<typeof version> => Boolean(version)
  )

  for (const version of ordered) {
    const directory = versionDirectory(version)
    if (directory && (await fse.pathExists(directory))) return true
  }
  return false
}

// ---------------------------------------------------------------------------------------------
// Refreshing
// ---------------------------------------------------------------------------------------------

/**
 * Re-check one game against the disk and delete whatever the disk has already settled.
 *
 * Two kinds of leftover are cleaned up, and neither is a decision any more:
 *
 * - **Conflicts whose folder is gone.** Adopting the folder is what turns it into a version, and
 *   ignoring it only keeps the scanner away from a folder that is already gone. A conflicting copy
 *   is normally inspected first (在资源管理器中打开) and then deleted by hand, and nothing would ever
 *   notice: the scanner only reports a folder when it walks over it, and a folder that is not there
 *   is not walked over. The record would sit in `pathConflicts` for ever.
 * - **Duplicate entries with no directory left.** Same reasoning one level up: there is no copy to
 *   keep, so there is nothing to decide about which one survives. The entry is deleted *without*
 *   folding its versions into the survivor — folding them in would put the dead directories back on
 *   screen under the surviving entry, which is exactly the row the user wanted gone.
 *
 * What is checked is the path as recorded in storage, never what the panel currently shows: the
 * button re-reads the library, and unsaved edits in the renderer are discarded rather than trusted.
 *
 * Only the entries this game's panel is showing are considered, matching the button that calls it —
 * another game's stale conflict is none of this panel's business.
 */
export async function refreshVersionReview(gameId: string): Promise<VersionReviewRefreshResult> {
  const groups = await buildGroups()
  const group =
    groups.find((candidate) => candidate.entries[0].gameId === gameId) ??
    groups.find((candidate) => candidate.entries.some((entry) => entry.gameId === gameId))

  if (!group) {
    // Nothing grouped here any more (settled elsewhere while the panel was open). Answering with
    // the stored detail keeps the caller's flow: it can still rebuild the panel from it.
    return {
      removedFolders: [],
      removedEntries: [],
      detail: await getVersionReview(gameId),
      reviews: await listVersionReviews()
    }
  }

  const [primary, ...others] = group.entries
  // `alive` has already been probed for this group by `buildGroups`, so this selects exactly what
  // the overview counts as 失效目录: duplicates with not a single directory left on disk.
  const dead = others.filter((entry) => !entry.alive)

  const removedEntries: string[] = []
  const removedGameIds: string[] = []
  const removedDirectories: string[] = []

  for (const entry of dead) {
    try {
      await removeEntry(entry.gameId)
    } catch (error) {
      log.error(`[VersionReview] Failed to remove a stale entry ${entry.gameId}:`, error)
      continue
    }
    removedGameIds.push(entry.gameId)
    removedEntries.push(entry.title)
    removedDirectories.push(...directoriesOf(entry.local))
  }

  const scope = new Set(group.entries.map((entry) => entry.gameId))
  const removedFolders = await dropConflictsWithMissingFolders(scope)

  if (removedEntries.length > 0 || removedFolders.length > 0) {
    await recordRefreshActions({
      gameId: primary.gameId,
      removedGameIds,
      removedEntries,
      directories: [...removedDirectories, ...removedFolders]
    })
  }

  const detail = await getVersionReview(gameId)
  const reviews = await listVersionReviews()
  if (removedEntries.length > 0 || removedFolders.length > 0) {
    ipcManager.send('version-conflict:changed', reviews)
  }

  return { removedFolders, removedEntries, detail, reviews }
}

/** Every directory an entry claims, alive or not. */
function directoriesOf(doc: gameLocalDoc): string[] {
  return listVersions(doc)
    .map((version) => versionDirectory(version))
    .filter((directory) => directory.length > 0)
}

/**
 * Write down what a refresh let go of, and keep the scanner out of the directories it left behind.
 *
 * Both halves land in the game's own record: `merge-entries` for the entries that were deleted, and
 * one `ignore-folder` per directory that is no longer worth reporting — which is also what puts them
 * in the properties dialog's "ignored folders" list, where each one can be dropped individually.
 * The scanner's ignore list is updated for the same reason: a directory that comes back (restored
 * from the recycle bin) is skipped rather than re-reported as a conflict.
 *
 * Deleting the directories outright is deliberately not on the table — the record is the only trace
 * the entry ever existed.
 */
async function recordRefreshActions(params: {
  gameId: string
  removedGameIds: string[]
  removedEntries: string[]
  directories: string[]
}): Promise<void> {
  const { gameId, removedGameIds, removedEntries, directories } = params

  const entries: VersionLogInput[] = []
  if (removedGameIds.length > 0) {
    entries.push({
      gameId,
      action: 'merge-entries' as const,
      mergedGameIds: removedGameIds,
      mergedTitles: removedEntries
    })
  }
  // One directory can arrive from both halves of the cleanup — a dead entry's folder that a
  // conflict was also about — and the record should name it once.
  for (const directory of Array.from(new Set(directories))) {
    entries.push({ gameId, action: 'ignore-folder' as const, directory })
    await addToScannerIgnoreList(directory)
  }

  await appendVersionLog(entries)

  // The deleted entries are gone; keep what they recorded under the entry that remains.
  for (const mergedId of removedGameIds) {
    await reKeyVersionLog(mergedId, gameId)
  }
}
/**
 * Delete the conflicts (of the given entries) whose recorded folder is no longer on disk.
 *
 * Existence is read from the conflict's own `newPath`, which is the path the scan stored — the
 * panel's unsaved edits never take part in this.
 */
async function dropConflictsWithMissingFolders(gameIds: Set<string>): Promise<string[]> {
  const conflicts = await listPathConflicts()
  const kept: PathConflict[] = []
  const removedFolders: string[] = []

  for (const conflict of conflicts) {
    const scoped = gameIds.has(conflict.gameId) && Boolean(conflict.newPath?.trim())
    if (scoped && !(await fse.pathExists(conflict.newPath))) {
      removedFolders.push(conflict.newPath)
      continue
    }
    kept.push(conflict)
  }

  if (removedFolders.length > 0) await writePathConflicts(kept)
  return removedFolders
}

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

export async function saveVersionReview(
  payload: VersionReviewSavePayload
): Promise<VersionReviewSaveResult> {
  const fail = async (error: string): Promise<VersionReviewSaveResult> => ({
    success: false,
    error,
    reviews: await listVersionReviews()
  })

  const rows = payload.versions ?? []
  if (rows.length === 0) return fail('At least one version is required')

  const doc = await GameDBManager.getExistingGameLocal(payload.gameId)
  if (!doc) return fail(`Game not found: ${payload.gameId}`)
  normalizeGameLocalDoc(doc)

  const originDocs = await loadOriginDocs(payload, doc)

  const previousVersions = doc.versions ?? {}
  const previousCurrent = doc.currentVersionId
  const nextVersions: GameLocalVersionMap = {}
  const usedIds = new Set<string>()

  for (const row of rows) {
    const originDoc = originDocs.get(row.originGameId)
    const seed =
      originDoc?.versions?.[row.id] ??
      (row.seedVersionId ? originDoc?.versions?.[row.seedVersionId] : undefined) ??
      previousVersions[row.id]

    const id = allocateVersionId(row, payload.gameId, previousVersions, usedIds)

    const block = seed
      ? deepClone(seed)
      : createVersionBlock(id, row.name, previousVersions[previousCurrent] ?? listVersions(doc)[0])

    const directory = normalizeDirectoryForStorage(row.path)
    block.id = id
    block.name = (row.name ?? '').trim()
    block.utils = {
      ...block.utils,
      markPath: directory,
      rootPath: directory ? inferRootPath(directory) : ''
    }
    block.path = {
      ...block.path,
      gamePath: await resolveExecutable(
        row.gamePath,
        directory,
        versionDirectory(seed ?? previousVersions[previousCurrent])
      )
    }

    nextVersions[id] = block
  }

  doc.versions = nextVersions
  if (!nextVersions[doc.currentVersionId]) {
    // The launch target's own version disappeared (a merge kept a different entry): fall back to
    // the primary slot rather than leaving `currentVersionId` dangling.
    doc.currentVersionId = getPrimaryVersionId(doc)
  }

  applyActiveVersionMirror(doc)

  try {
    await GameDBManager.setGameLocal(payload.gameId, doc)
  } catch (error) {
    log.error('[VersionReview] Failed to write versions:', error)
    return fail(error instanceof Error ? error.message : String(error))
  }

  // Titles have to be read while the entries still exist — `removeMergedEntries` deletes them.
  const mergeTitles = await loadGameTitles(payload.mergeGameIds ?? [])

  const handledConflicts = await applyConflictDecisions(payload)
  const deletion = await removeMergedEntries(payload)

  await recordSaveActions(payload, handledConflicts, deletion.removed, mergeTitles)

  const reviews = await listVersionReviews()
  ipcManager.send('version-conflict:changed', reviews)

  return {
    success: true,
    error: deletion.errors.length > 0 ? deletion.errors.join('\n') : undefined,
    reviews
  }
}

/**
 * A version id must stay unique inside the surviving entry. Rows that came from another entry keep
 * their own ids only when nothing in the target claims that id already — two entries of the same
 * game both shipping a `default` version is the normal case, not the exception.
 */
function allocateVersionId(
  row: VersionReviewSavePayload['versions'][number],
  primaryGameId: string,
  previousVersions: GameLocalVersionMap,
  usedIds: Set<string>
): string {
  // A row only owns its id when it came from the surviving entry: the same id in another entry is a
  // different version that merely happens to share the name.
  const ownsId = !row.originGameId || row.originGameId === primaryGameId

  const available = (candidate: string): boolean =>
    candidate.length > 0 &&
    !usedIds.has(candidate) &&
    (ownsId || previousVersions[candidate] === undefined)

  let id = (row.id ?? '').trim()
  if (!available(id)) id = generateUUID()
  while (!available(id)) id = generateUUID()

  usedIds.add(id)
  return id
}

async function loadOriginDocs(
  payload: VersionReviewSavePayload,
  primary: gameLocalDoc
): Promise<Map<string, gameLocalDoc>> {
  const originIds = new Set((payload.versions ?? []).map((row) => row.originGameId))
  originIds.add(payload.gameId)

  const docs = new Map<string, gameLocalDoc>()
  for (const gameId of originIds) {
    if (gameId === payload.gameId) {
      docs.set(gameId, primary)
      continue
    }
    const doc = await GameDBManager.getExistingGameLocal(gameId)
    if (doc) {
      normalizeGameLocalDoc(doc)
      docs.set(gameId, doc)
    }
  }
  return docs
}

/**
 * Keep the recorded executable only while the version stays where it was.
 *
 * When the directory changes the old executable no longer belongs to this version, so we look for a
 * same-named file inside the new directory and clear the field when there is none — an empty
 * executable is visible in the properties dialog, while one pointing at a different folder is a
 * silent mislaunch.
 */
async function resolveExecutable(
  recorded: string,
  directory: string,
  previousDirectory: string
): Promise<string> {
  const recordedPath = (recorded ?? '').trim()
  if (!directory) return recordedPath
  if (normalizeDirectoryKey(directory) === normalizeDirectoryKey(previousDirectory)) {
    return recordedPath
  }
  if (!recordedPath) return ''

  const directoryKey = normalizeDirectoryKey(directory)
  if (normalizeDirectoryKey(recordedPath).startsWith(`${directoryKey}/`)) return recordedPath

  return (await findFileByName(directory, path.basename(recordedPath))) ?? ''
}

/**
 * Drop the conflicts the user just handled, and honour the "ignore these folders" switch.
 *
 * Returns the conflicts as they were read, so the caller can log what was done with them — they are
 * gone from storage by the time this returns.
 */
async function applyConflictDecisions(payload: VersionReviewSavePayload): Promise<PathConflict[]> {
  const handled = new Set([
    ...(payload.adoptedConflictIds ?? []),
    ...(payload.droppedConflictIds ?? [])
  ])
  if (handled.size === 0 && (payload.mergeGameIds ?? []).length === 0) return []

  const conflicts = await listPathConflicts()
  const droppedIds = new Set(payload.droppedConflictIds ?? [])
  const mergedIds = new Set(payload.mergeGameIds ?? [])

  if (payload.ignoreFolder) {
    for (const conflict of conflicts) {
      if (droppedIds.has(conflict.id)) await addToScannerIgnoreList(conflict.newPath)
    }
  }

  // Conflicts belonging to an entry that no longer exists have nothing left to resolve either.
  await writePathConflicts(
    conflicts.filter((conflict) => !handled.has(conflict.id) && !mergedIds.has(conflict.gameId))
  )

  return conflicts
}

/** Delete the entries whose versions were folded into the survivor. */
async function removeMergedEntries(
  payload: VersionReviewSavePayload
): Promise<{ removed: string[]; errors: string[] }> {
  const errors: string[] = []
  const removed: string[] = []

  for (const gameId of payload.mergeGameIds ?? []) {
    if (!gameId || gameId === payload.gameId) continue
    try {
      await removeEntry(gameId)
      removed.push(gameId)
    } catch (error) {
      log.error(`[VersionReview] Failed to remove merged entry ${gameId}:`, error)
      errors.push(`${gameId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { removed, errors }
}

/** Drop a library entry, leaving no dangling ids behind in collections. */
async function removeEntry(gameId: string): Promise<void> {
  // Collections keep dangling ids otherwise, and the library would show a ghost tile.
  await GameDBManager.removeGameFromAllCollections(gameId)
  await GameDBManager.removeGame(gameId)
}

/**
 * Write down what this save changed, so the game's "Records" tab can show it later.
 *
 * The merge entry is added before the surviving entry's own history is moved over: a merge can only
 * happen once, and the moved entries must not end up after it in time order.
 */
async function recordSaveActions(
  payload: VersionReviewSavePayload,
  conflicts: PathConflict[],
  mergedGameIds: string[],
  mergeTitles: Map<string, string>
): Promise<void> {
  const ignoredIds = new Set(payload.ignoreFolder ? (payload.droppedConflictIds ?? []) : [])
  const adoptedIds = new Set(payload.adoptedConflictIds ?? [])

  const entries: VersionLogInput[] = []

  if (mergedGameIds.length > 0) {
    entries.push({
      gameId: payload.gameId,
      action: 'merge-entries' as const,
      mergedGameIds,
      mergedTitles: mergedGameIds.map((gameId) => mergeTitles.get(gameId) ?? gameId)
    })
  }

  for (const conflict of conflicts) {
    if (ignoredIds.has(conflict.id)) {
      entries.push({
        gameId: payload.gameId,
        action: 'ignore-folder' as const,
        directory: conflict.newPath
      })
    } else if (adoptedIds.has(conflict.id)) {
      entries.push({
        gameId: payload.gameId,
        action: 'adopt-folder' as const,
        directory: conflict.newPath,
        versionName: versionNameForPath(payload, conflict)
      })
    }
  }

  await appendVersionLog(entries)

  // The merged entries are gone; keep what they recorded under the entry that absorbed them.
  for (const gameId of mergedGameIds) {
    await reKeyVersionLog(gameId, payload.gameId)
  }
}

/** The name the adopted folder ended up under — the row that points at it, else the folder's label. */
function versionNameForPath(payload: VersionReviewSavePayload, conflict: PathConflict): string {
  const key = normalizeDirectoryKey(conflict.newPath)
  const row = (payload.versions ?? []).find(
    (version) => normalizeDirectoryKey(version.path) === key
  )
  return (row?.name ?? conflict.versionLabel ?? '').trim()
}

/** Titles of the entries about to be deleted, keyed by id, for the record's copy. */
async function loadGameTitles(gameIds: string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  if (gameIds.length === 0) return titles

  const games = await GameDBManager.getAllGames()
  for (const gameId of gameIds) {
    const metadata = games[gameId]?.metadata
    titles.set(gameId, metadata?.name || metadata?.originalName || gameId)
  }
  return titles
}

// ---------------------------------------------------------------------------------------------
// Path probes
// ---------------------------------------------------------------------------------------------

/**
 * Existence checks for the directories the editor is showing, so the red highlighting reflects the
 * disk rather than the last time the dialog opened. Keyed by the requested string.
 */
export async function checkVersionPaths(paths: string[]): Promise<Record<string, boolean>> {
  const unique = Array.from(new Set((paths ?? []).map((value) => (value ?? '').trim())))
  const results = await Promise.all(
    unique.map(async (value) => [value, value ? await fse.pathExists(value) : false] as const)
  )
  return Object.fromEntries(results)
}

/** Re-exported so the scanner can announce a new conflict without importing the whole workbench. */
export async function pushVersionReviews(): Promise<void> {
  ipcManager.send('version-conflict:changed', await listVersionReviews())
}
