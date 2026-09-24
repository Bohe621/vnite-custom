/**
 * Identity-based fallback deduplication for the scanner.
 *
 * The scanner matches folders to games by path first. When that fails, the game may simply have
 * moved (or been re-downloaded elsewhere), so before creating a brand new entry we scrape the
 * folder and ask whether an existing game *is* this game:
 *
 * - no existing game matches -> nothing to do, the caller adds it normally;
 * - exactly one matches and the directory recorded for the target version is gone -> the folder is
 *   adopted silently (this is the move case, and the whole point of the fallback);
 * - anything else (several games match, or the recorded directory is still there) -> a conflict,
 *   surfaced to the user instead of being guessed at.
 *
 * The version a folder belongs to comes from its name: `Game v1.2` targets the version named
 * `1.2`, a name without a version marker targets the primary (`default`) slot. A label that matches
 * no existing version turns the primary slot into that version, so the new copy takes over the
 * role of "the game as installed here" while the label stays visible in the version selector.
 */
import type { GameMetadata } from '@appTypes/utils'
import { normalizeGameIdentityKey, parseVersionSuffix } from '@appUtils'
import { GameDBManager } from '~/core/database'
import { scraperManager } from '~/features/scraper'
import * as path from 'path'
import {
  adoptScannedDirectory,
  resolveTargetVersion,
  type PathConflictInput
} from './pathConflicts'

interface IdentityCandidate {
  gameId: string
  title: string
  /** Directory recorded for the version this folder would be routed to. */
  path: string
  pathExists: boolean
  versionId: string
  versionName: string
  /** True when the folder carries a version label that no existing version matches. */
  versionMissing: boolean
  /** Lower is a stronger identity match. */
  rank: number
}

export interface FolderIdentityResolution {
  kind: 'new' | 'adopted' | 'conflict'
  /** Metadata fetched while resolving, handed to `addGameToDB` so it need not ask again. */
  metadata: GameMetadata
  gameId?: string
  versionId?: string
  /** Set when `kind === 'adopted'`: the version name the folder ended up under. */
  versionName?: string
  /** Set when `kind === 'conflict'`. */
  conflict?: PathConflictInput
}

/**
 * Decide what to do with a folder that no known game claims by path.
 *
 * Never throws for "not a duplicate": a lookup failure here must not cost the user the game, so any
 * unexpected problem degrades to `kind: 'new'`.
 */
export async function resolveFolderIdentity(params: {
  dataSource: string
  dataSourceId: string
  dirPath: string
}): Promise<FolderIdentityResolution> {
  const { dataSource, dataSourceId, dirPath } = params

  const metadata = await scraperManager.getGameMetadata(dataSource, {
    type: 'id',
    value: dataSourceId
  })

  const versionLabel = parseVersionSuffix(path.basename(dirPath))
  const candidates = await findIdentityCandidates(metadata, dataSource, versionLabel)

  if (candidates.length === 0) {
    return { kind: 'new', metadata }
  }

  const primary = candidates[0]
  const ambiguous = candidates.length > 1
  const conflicting = ambiguous || primary.pathExists

  if (conflicting) {
    return {
      kind: 'conflict',
      metadata,
      gameId: primary.gameId,
      versionId: primary.versionId,
      conflict: {
        kind: ambiguous ? 'ambiguous' : 'path-exists',
        newPath: dirPath,
        versionLabel: versionLabel ?? '',
        scrapedName: metadata.name ?? '',
        dataSource,
        dataSourceId,
        gameId: primary.gameId,
        versionId: primary.versionId,
        versionName: primary.versionName,
        existingPath: primary.path,
        existingPathExists: primary.pathExists,
        candidates: candidates.map((candidate) => ({
          gameId: candidate.gameId,
          title: candidate.title,
          path: candidate.path,
          pathExists: candidate.pathExists
        }))
      }
    }
  }

  const renameTo = primary.versionMissing && versionLabel ? versionLabel : undefined
  await adoptScannedDirectory({
    gameId: primary.gameId,
    versionId: primary.versionId,
    directory: dirPath,
    // A labelled folder taking over the primary slot becomes that version, e.g. `1.2`.
    renameVersionTo: renameTo
  })

  return {
    kind: 'adopted',
    metadata,
    gameId: primary.gameId,
    versionId: primary.versionId,
    versionName: renameTo ?? primary.versionName
  }
}

/**
 * Existing games that scraped metadata says are the same game, strongest match first.
 *
 * The data source id is authoritative (same provider, same product). Titles are the fallback, since
 * that is all older entries or other providers can offer.
 */
async function findIdentityCandidates(
  metadata: GameMetadata,
  dataSource: string,
  versionLabel: string | null
): Promise<IdentityCandidate[]> {
  const games = await GameDBManager.getAllGames()

  const scrapedSourceId = (metadata as Record<string, unknown>)[`${dataSource}Id`]
  const scrapedOriginal = normalizeGameIdentityKey(metadata.originalName ?? '')
  const scrapedName = normalizeGameIdentityKey(metadata.name ?? '')

  const matches: { gameId: string; title: string; rank: number }[] = []

  for (const game of Object.values(games)) {
    const gameMetadata = game.metadata
    if (!gameMetadata) continue

    const gameTitle = gameMetadata.name || gameMetadata.originalName || game._id

    let rank: number | null = null
    if (
      scrapedSourceId &&
      (gameMetadata as Record<string, unknown>)[`${dataSource}Id`] === scrapedSourceId
    ) {
      rank = 0
    } else if (
      scrapedOriginal &&
      normalizeGameIdentityKey(gameMetadata.originalName ?? '') === scrapedOriginal
    ) {
      rank = 1
    } else if (scrapedName && normalizeGameIdentityKey(gameMetadata.name ?? '') === scrapedName) {
      rank = 2
    }

    if (rank !== null) matches.push({ gameId: game._id, title: gameTitle, rank })
  }

  matches.sort((a, b) => a.rank - b.rank)

  const candidates: IdentityCandidate[] = []
  for (const match of matches) {
    const target = await resolveTargetVersion(match.gameId, versionLabel)
    if (!target) continue
    candidates.push({
      gameId: match.gameId,
      title: match.title,
      path: target.directory,
      pathExists: target.directoryExists,
      versionId: target.versionId,
      versionName: target.versionName,
      versionMissing: target.versionMissing,
      rank: match.rank
    })
  }

  // Strongest identity first; between equally strong matches the one whose directory is gone is
  // the likelier owner of the new folder, so it leads (and is what the dialog preselects).
  candidates.sort((a, b) => a.rank - b.rank || Number(a.pathExists) - Number(b.pathExists))

  return candidates
}
