/**
 * The version-conflict workbench — a library-wide pass over "games whose version data does not add
 * up", opened from the sidebar `!` button and from *Settings → Database → Organise game versions*.
 *
 * Two problems land in the same list because the fix is the same (give one game entry the right set
 * of versions) and the user should not have to visit two screens:
 *
 * - **Scanned folders waiting for a decision.** The scanner's identity fallback (`pathConflicts.ts`)
 *   refuses to guess when a folder could belong to several games or when the recorded directory is
 *   still there. Those records become `incoming` rows.
 * - **Duplicate library entries that share a source id.** Older scanners deduplicated by path only,
 *   so re-downloading a game to a new folder created a second entry for the same product. Merging
 *   them keeps one entry and turns each other entry's directory into a version of it.
 *
 * The workbench never writes on its own: the renderer edits everything locally (validating as it
 * goes) and the whole group is committed by one `version-review:save` call.
 */
import type { PathConflictKind } from './gameConflict'

/** Why a game is listed in the workbench. A game can carry both. */
export type VersionReviewReason =
  /** A scanned folder is waiting for a decision. */
  | 'scan-conflict'
  /** Several library entries share this game's source id. */
  | 'duplicate-entries'

/**
 * How a version row is doing. `missing` / `duplicate` are what the UI paints red.
 *
 * - `ok` — the directory is set and on disk, and no other row claims it.
 * - `missing` — the directory is empty or gone (this is the "the game moved" case).
 * - `duplicate` — another row in the same review points at the same directory.
 */
export type VersionReviewVersionStatus = 'ok' | 'missing' | 'duplicate'

export interface VersionReviewSummary {
  /** Primary game entry — the one that survives a merge and owns the resulting version list. */
  gameId: string
  title: string
  reasons: VersionReviewReason[]
  /** Library entries grouped here (1 when only a scanned folder needs a decision). */
  entryCount: number
  /**
   * Of the duplicates above, how many have nothing left on disk — none of their directories exists
   * any more. They are the cheap half of the problem: there is no copy to keep, only an entry to
   * merge away, so the overview counts them apart from the duplicates that still hold a folder.
   */
  staleEntryCount: number
  /** Scanned directories waiting for a decision. */
  incomingCount: number
  /** Versions across every entry of the group. */
  versionCount: number
}

export interface VersionReviewVersion {
  id: string
  /**
   * Display name. An unnamed version is pre-filled with the version number (or the folder name) it
   * points at, so merging two entries never leaves the game with two anonymous rows. The editor
   * shows the value in an input, so the user sees and can change it before saving.
   */
  name: string
  /** Directory (`utils.markPath`). */
  path: string
  /** Executable (`path.gamePath`). */
  gamePath: string
  /** Library entry this version belongs to. Differs from the review's `gameId` after a merge. */
  originGameId: string
  /** Title of that entry, so the UI can label rows that came from a duplicate. */
  originTitle: string
  /**
   * Primary directory of that entry. Duplicate entries usually share a title, so the folder is what
   * actually tells two rows apart in the editor.
   */
  originDirectory: string
  /** True when the primary entry already holds a version under this id. */
  existing: boolean
  pathExists: boolean
  status: VersionReviewVersionStatus
  /** For `status === 'duplicate'`: id of the version this row collides with. */
  duplicateOf?: string
}

/** A scanned directory that the scanner could not place on its own. */
export interface VersionReviewIncoming {
  conflictId: string
  path: string
  /**
   * Name to pre-fill for the version this folder would become. The version marker in the folder
   * name when it has one (`Game v1.2` → `1.2`), else the id of the slot the scanner routed the
   * folder to — `default` for an unlabelled folder. Never the folder name: that describes the
   * directory, not the version it is about to become.
   */
  label: string
  /** Version the scanner wanted to write into. */
  targetVersionId: string
  /** Directory currently recorded for that version. */
  targetPath: string
  kind: PathConflictKind
}

export interface VersionReviewDetail {
  gameId: string
  title: string
  reasons: VersionReviewReason[]
  versions: VersionReviewVersion[]
  incoming: VersionReviewIncoming[]
  /** Duplicate library entries folded into this one — removed once the save succeeds. */
  mergeGameIds: string[]
  /** Their titles, for the confirmation copy. */
  mergeTitles: string[]
}

/** One row of the version list as the user left it. */
export interface VersionReviewSaveVersion {
  id: string
  name: string
  path: string
  gamePath: string
  /**
   * Entry the row was read from. The main process copies that entry's version block (launcher,
   * utils, …) when the version does not exist in the primary game yet; a row edited in place keeps
   * its own block untouched.
   */
  originGameId: string
  /**
   * Version in `originGameId` whose block seeds this row when the row itself is brand new — the
   * case for a scanned directory the scanner wanted to write into an existing version: the row is
   * a new version, but it should inherit that version's launcher and tracking settings.
   */
  seedVersionId?: string
}

export interface VersionReviewSavePayload {
  /** Primary game entry to write into. */
  gameId: string
  /** The complete version list, in display order. At least one row is required. */
  versions: VersionReviewSaveVersion[]
  /** Conflicts adopted as versions — their directory becomes the row's directory. */
  adoptedConflictIds: string[]
  /** Conflicts rejected; their directories are left alone. */
  droppedConflictIds: string[]
  /** Also add the rejected directories to the scanner ignore list. */
  ignoreFolder?: boolean
  /** Entries to delete once their versions have been folded in. */
  mergeGameIds: string[]
}

export interface VersionReviewSaveResult {
  success: boolean
  error?: string
  /** Reviews remaining after the save, so the caller can refresh without a second round trip. */
  reviews: VersionReviewSummary[]
}

/** What re-checking one game against the disk found, and cleaned up. */
export interface VersionReviewRefreshResult {
  /**
   * Folders that are gone, and whose conflict records were deleted as a result.
   *
   * A conflict without a folder is not a decision, it is a leftover: adopting the folder is what
   * makes it a version, and ignoring it is only worth doing while the scanner could still walk into
   * it. So `pathConflicts` drops the record instead of going on asking about a dead directory.
   */
  removedFolders: string[]
  /**
   * Titles of the duplicate library entries that were deleted because none of their directories is
   * on disk any more.
   *
   * Same reasoning as `removedFolders`, one level up: an entry with no folder left has no copy to
   * keep, so its versions are not folded into the survivor — folding them in would only put the
   * dead directories back on screen under the surviving entry. The entry goes, and the log records
   * it (`merge-entries`, plus an `ignore-folder` for each directory it used to hold).
   */
  removedEntries: string[]
  /** The game's review after the cleanup — `null` when it needs no decision any more. */
  detail: VersionReviewDetail | null
  /** Remaining summaries, so the overview and the sidebar badge follow the cleanup. */
  reviews: VersionReviewSummary[]
}

// ---------------------------------------------------------------------------------------------
// Processing log
// ---------------------------------------------------------------------------------------------

/**
 * What the workbench (or the scanner's own fallback) did to a game.
 *
 * Only `ignore-folder` is reversible: it is the one action whose only effect is "the scanner skips
 * this folder from now on", so removing it puts the folder back in front of the scanner. Merges and
 * adoptions have already rewritten the library, and are kept purely as a record.
 */
export type VersionReviewLogAction =
  /** A scanned folder was rejected, and added to the scanner ignore list. */
  | 'ignore-folder'
  /** A scanned folder was taken over as a version of an existing game. */
  | 'adopt-folder'
  /** Duplicate library entries were folded into one and deleted. */
  | 'merge-entries'

export interface VersionReviewLogEntry {
  id: string
  /** Game the action was taken on. Entries of merged-away games are re-keyed to the survivor. */
  gameId: string
  action: VersionReviewLogAction
  /** ISO timestamp. */
  at: string
  /** `ignore-folder` / `adopt-folder`: the folder this was about. */
  directory?: string
  /** `adopt-folder`: name of the version the folder became. */
  versionName?: string
  /** `merge-entries`: entries that were deleted after their versions were folded in. */
  mergedGameIds?: string[]
  /** `merge-entries`: their titles, for display (the entries themselves are gone by then). */
  mergedTitles?: string[]
}

/** A log entry as the record tab shows it. */
export interface VersionReviewLogItem extends VersionReviewLogEntry {
  /** Only ignored folders can be undone. */
  revertible: boolean
  /** For `ignore-folder`: the folder is still in the scanner ignore list. */
  active: boolean
}

export interface VersionReviewRecord {
  gameId: string
  items: VersionReviewLogItem[]
}

export interface VersionReviewRecordResult {
  success: boolean
  error?: string
  record: VersionReviewRecord
}
