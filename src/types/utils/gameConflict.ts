/**
 * Path conflicts raised by the scanner's identity-based fallback deduplication.
 *
 * Scanning deduplicates by path first (`GameDBManager.findExistingGameIdByPath`). When a folder is
 * not under any known game's root, the scanner scrapes it and tries to recognise the game by
 * identity (same data source id, or the same original/title name). If exactly one existing game
 * matches and the directory recorded for the target version is gone, the new directory is adopted
 * silently — that is a moved (or newly downloaded copy of the same) game, not a new entry.
 *
 * Everything else cannot be decided automatically and is surfaced as a conflict for the user:
 * - the identity matched more than one game (`ambiguous`), or
 * - the target version still points at an existing directory (`path-exists`), so adopting would
 *   silently drop a working copy.
 */

export type PathConflictKind = 'ambiguous' | 'path-exists'

/** One game that the scanned folder could belong to. */
export interface PathConflictCandidate {
  gameId: string
  /** Display title of the existing game. */
  title: string
  /** Directory currently recorded for the candidate game's target version. */
  path: string
  pathExists: boolean
}

/** What the user can do with a conflict from the sidebar dialog. */
export type PathConflictAction =
  /** Point the version at the newly scanned directory. */
  | 'use-new'
  /** Keep the recorded directory and drop the new one (optionally ignoring it in future scans). */
  | 'keep-old'
  /** Keep both: register the new directory as an extra version of the game. */
  | 'add-version'
  /** Just remove the conflict entry; no database change, next scan will raise it again. */
  | 'ignore'

export interface PathConflict {
  id: string
  kind: PathConflictKind
  /** Directory the scanner found this time. */
  newPath: string
  /** Version label parsed out of the folder name (`1.2`), empty when the folder has none. */
  versionLabel: string
  /** Name returned by the scraper for the scanned folder. */
  scrapedName: string
  dataSource: string
  dataSourceId: string
  /** Matched game. The first candidate when `kind === 'ambiguous'`. */
  gameId: string
  /** Version the scanner wanted to write into. */
  versionId: string
  versionName: string
  /** Directory currently recorded for that version. */
  existingPath: string
  existingPathExists: boolean
  /** Every game the identity matched, in match order. */
  candidates: PathConflictCandidate[]
  createdAt: string
}

export interface PathConflictResolutionOptions {
  /** Override the target game when `kind === 'ambiguous'`. */
  targetGameId?: string
  /** For `keep-old` / `ignore`: also add the new folder to the scanner ignore list. */
  ignoreFolder?: boolean
  /** For `add-version`: name of the created version. Defaults to the version label. */
  versionName?: string
}

export interface PathConflictResolutionResult {
  success: boolean
  error?: string
  /** Remaining conflicts after the action, so the caller can refresh without a second round trip. */
  conflicts: PathConflict[]
}
