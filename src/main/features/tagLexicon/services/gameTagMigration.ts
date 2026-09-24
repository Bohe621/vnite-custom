import type {
  GameTagMigrationResult,
  GameTagMigrationSample,
  TagLexiconMigrateGameTagsParams
} from '@appTypes/models'
import log from 'electron-log/main.js'

import { GameDBManager } from '~/core/database'
import { getTagLanguage } from '~/features/system/services/i18n'
import { isInternalKey, TagLexiconManager } from './lexicon'

/** 最多回传几条 before/after 样例（足够核对，不至于把 IPC 撑爆） */
const SAMPLE_LIMIT = 8

/** 只压掉重复、保留首次出现的顺序：标签是集合语义，顺序由首次写入决定 */
function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * 把全库 `metadata.tags` 里**还没迁移的老原文**换成实体 key。
 *
 * 背景：词库是后加的功能，之前入库的 1400+ 个标签值全是抓取当时的原文（DLsite 的中文分类名、
 * vndb 的英文名）。它们能显示（`displayMap` 认不出就原样返回），但**筛选是精确匹配存储值的**，
 * 于是「存 key 的新数据」与「存原文的老数据」在筛选里是两个不同的值；改名、按语言显示也都不生效。
 *
 * 两趟跑：
 * 1. **只统计 + 学习映射**（不写任何东西）：已经是 key 的跳过；`resolve()` 命中的记下
 *    `原文 -> 实体 key`；剩下的进 `unknown`。
 * 2. **写库**：按第一趟的映射重算每个文档的 `tags`（去重、保序），只写真正变化的文档。
 *
 * `unknown` 有两种处置：开着 `mintUnknown` 就铸成新实体（provider 记 `user`、语言按当前界面语言，
 * 与「详情页手写标签」同一条路）；关着就原样保留（行为与迁移前一致）。
 * ⚠️ dry-run **不铸实体** —— 预览不该产生副作用，所以那时的 `minted` 是 0、`unknown` 是全量。
 */
export async function migrateGameTags(
  options: TagLexiconMigrateGameTagsParams = {}
): Promise<GameTagMigrationResult> {
  const dryRun = options.dryRun ?? true
  const mintUnknown = !dryRun && (options.mintUnknown ?? false)
  const lexicon = TagLexiconManager.getInstance()
  const lang = getTagLanguage()

  const games = await GameDBManager.getAllGames()
  const entries = Object.entries(games).filter(
    ([gameId, game]) =>
      gameId !== 'collections' &&
      Array.isArray(game?.metadata?.tags) &&
      (game.metadata.tags?.length ?? 0) > 0
  )

  // —— 第一趟：只统计与学习映射 ——
  const resolved = new Map<string, string>()
  const unknown = new Map<string, number>()
  let values = 0
  let alreadyKey = 0
  let resolvedValues = 0

  for (const [, game] of entries) {
    for (const raw of game.metadata.tags ?? []) {
      if (typeof raw !== 'string' || !raw.trim()) continue
      const value = raw.trim()
      values++
      if (isInternalKey(value)) {
        alreadyKey++
        continue
      }
      const hit = resolved.get(value) ?? lexicon.resolve(value)
      if (hit) {
        resolved.set(value, hit)
        resolvedValues++
        continue
      }
      unknown.set(value, (unknown.get(value) ?? 0) + 1)
    }
  }

  // 铸新实体（只在真跑且开关打开时）。整批一次落盘，避免逐个重建 3000 条实体的索引
  let minted = 0
  if (mintUnknown && unknown.size > 0) {
    const raws = [...unknown.keys()]
    const keys = await lexicon.ensureTags(raws, 'user', lang)
    raws.forEach((raw, index) => {
      resolved.set(raw, keys[index])
      minted += unknown.get(raw) ?? 0
      unknown.delete(raw)
    })
    log.info(`[TagLexicon] Game tag migration minted ${raws.length} user tags`)
  }

  // —— 第二趟：算出每个文档的新值（dry-run 时只统计，不写）——
  const samples: GameTagMigrationSample[] = []
  let gamesChanged = 0
  for (const [gameId, game] of entries) {
    const before = dedupe((game.metadata.tags ?? []).map((tag) => tag.trim()).filter(Boolean))
    const after = before.map((value) =>
      isInternalKey(value) ? value : (resolved.get(value) ?? value)
    )
    if (sameArray(before, after)) continue
    gamesChanged++
    if (!dryRun) await GameDBManager.setGameValue(gameId, 'metadata.tags', after)
    if (samples.length < SAMPLE_LIMIT) {
      samples.push({ gameId, name: game.metadata.name ?? gameId, before, after })
    }
  }

  const unknownTop = [...unknown.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([raw, count]) => ({ raw, count }))
  const unknownValues = [...unknown.values()].reduce((sum, count) => sum + count, 0)
  const unknownDistinct = unknown.size

  log.info(
    `[TagLexicon] Game tag migration ${dryRun ? '(dry run) ' : ''}` +
      `games=${entries.length} changed=${gamesChanged} values=${values} ` +
      `alreadyKey=${alreadyKey} resolved=${resolvedValues} minted=${minted} unknown=${unknownValues}`
  )

  return {
    dryRun,
    games: entries.length,
    gamesChanged,
    values,
    alreadyKey,
    resolved: resolvedValues,
    minted,
    unknown: unknownValues,
    unknownDistinct,
    samples,
    unknownTop
  }
}
