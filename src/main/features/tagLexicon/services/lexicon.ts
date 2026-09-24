import type {
  TagLexiconConflict,
  TagLexiconEntity,
  TagLexiconFile,
  TagLexiconImportSummary,
  TagLexiconMoveSourceResult,
  TagLexiconQueryResult,
  TagLexiconQueryScope,
  TagLexiconRemoveSourceResult,
  TagLexiconState,
  TagLexiconTagRecord
} from '@appTypes/models'
import { createHash } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import fse from 'fs-extra'
import log from 'electron-log/main.js'

import { ipcManager } from '~/core/ipc'
import { VNDB_OFFICIAL_TAGS } from '~/features/scraper/providers/vndb/tags-official'
import { VNDB_TAG_ZH } from '~/features/scraper/providers/vndb/tags-zh'
import { getDataPath } from '~/features/system/services/path'

/**
 * 用户自建的「标签主数据」（tag lexicon）。
 *
 * 文件位置：<userData>/app/database/tag-lexicon.json
 * （与 theme.v4.css 同目录，dev 下是 D:\work\Vnite\dev\app\database\tag-lexicon.json）
 *
 * 模型：一个标签 = 一条实体，key 是内部稳定标识，与「名字」完全分离。
 *   key 语法：`@<命名空间>:<规范化原串>`，命名空间是抓取源或 user。
 *   例：`@vndb:yuri`、`@bangumi:纯爱`、`@user:小众神作`
 *   `@` 前缀是语法保证：抓取源返回的标签原文不会以 @ 开头，所以内部 key
 *   永远不会和用户可见字符串混淆。
 *
 * 解析（入库时）：**有源内稳定 id 就只认 id** —— id 命中就用那条，没命中直接按 id 铸新实体，
 *   不再退到「按文本归并」（不同概念可能撞同一个词，自动并掉就是静默的错并；
 *   撞名会记成冲突交给「冲突管理」，见 `recordDuplicateConflict`）。
 *   没有稳定 id 的源（vndb / bangumi 等语言固定的源）才走 src -> 跨源名字的文本归并。
 *   新铸的实体若与已有实体在某个语言上同名，或与该实体已有译名不一致，都记成冲突。
 *
 * 显示（渲染时）：names[当前语言] -> 同语族变体 -> fallback 链 -> 任意可用名 -> 剥前缀的 key。
 *   数据库里存的是 key，所以切语言不影响筛选结果。
 *
 * 内置表（tags-zh.ts 的 2708 条英→中）不写进文件，而是作为「虚拟实体」参与内存合并，
 * 这样上游更新内置表时能自动生效，文件里只留用户真正改动过的部分。
 */

/** 内部 key 前缀，抓取源的标签原文不会以此开头 */
export const INTERNAL_KEY_PREFIX = '@'

/** 默认的补充回退链（同语族互回退由代码自动处理，不需要写在这里） */
export const DEFAULT_FALLBACK = ['en']

const LEXICON_VERSION = 2
const MAX_REDIRECT_HOPS = 10
const WATCH_INTERVAL_MS = 2000
const SELF_WRITE_GRACE_MS = 3000

/**
 * 各抓取源返回标签时使用的语言，用于铸造实体时登记第一份译名。
 *
 * ⚠️ **只适用于「标签文本语言固定」的源**。DLsite 故意不在表里：它的标签文本是服务器
 * 按 `?locale=` 渲染的（中文界面拿到的就是中文、日文界面才是日文），语言由 provider
 * 自己在 `GameMetadata.tagsDetail.language` 里报上来。推断成固定 `ja` 会把中文原文
 * 写进 `names.ja`（实测：31 个 DLsite 中文标签里 27 个认不出、全会踩这个坑）。
 */
const PROVIDER_LANGUAGE: Record<string, string> = {
  vndb: 'en',
  igdb: 'en',
  steam: 'en',
  bangumi: 'zh-Hans',
  erogamescape: 'ja'
}

/** 语言无法归到已知族时的占位代码；它不参与同语族回退，只能被「任意可用名」兜住 */
const UNDETERMINED_LANGUAGE = 'und'

/**
 * 平假名 / 片假名（含半角片假名）。
 *
 * 用「含假名」而不是「含汉字」来判定日文别名：vndb 的**汉字别名里中日常混**
 * （`少女前线` 是简中、`麻雀` 是日文、`拟人化` 是中文写法），没有可靠的自动区分手段；
 * 而假名是日语独有的书写记号，命中即日语（3014 个 tag 里 53 个有假名别名）。
 */
const JAPANESE_KANA = /[\u3041-\u309f\u30a0-\u30ff\uff66-\uff9d]/

/** 整词都是拉丁字母（用于掐掉日文名里的英文修饰词） */
const PURE_LATIN_WORD = /^[A-Za-z]+$/
/** 任意拉丁字母 */
const HAS_LATIN = /[A-Za-z]/

/**
 * 把「英日混合别名」收敛成日语核心词。
 *
 * vndb 的别名里有 9 条是英日混写，其中 7 条属于「伪娘」家族 —— vndb 给这一族挂的
 * 别名形如 `Male on 男の娘`、`男の娘 Heroine`、`男の娘 on Male`，取整串当 `names.ja`
 * 会得到「中英夹杂」的显示名。这里掐掉**首尾整词都是拉丁字母**的空白分词，
 * 但仅在掐完之后整串已无拉丁字母时才采用 —— 否则宁可原样保留：
 * - `Male on 男の娘` / `男の娘 on Male` → `男の娘`
 * - `コマンド選択式ADV`：拉丁词与日文粘连（无空白分词），原样保留
 * - `To LOVEる -とらぶる-`：掐掉前导 `To` 后仍有 `LOVEる` 带拉丁字母 → 原样保留
 *
 * 实测只改判上述 7 条，其余 46 条（44 条纯日文 + 2 条 ADV）逐字不变。
 */
function japaneseCore(alias: string): string {
  if (!HAS_LATIN.test(alias)) return alias
  const tokens = alias.split(/\s+/)
  let a = 0
  let b = tokens.length
  while (a < b && PURE_LATIN_WORD.test(tokens[a])) a++
  while (b > a && PURE_LATIN_WORD.test(tokens[b - 1])) b--
  if (b <= a) return alias
  const core = tokens.slice(a, b).join(' ')
  return HAS_LATIN.test(core) ? alias : core
}

interface EffectiveTag {
  key: string
  names: Record<string, string>
  src: Record<string, string[]>
  ids: Record<string, string[]>
  origin: 'builtin' | 'user'
  /**
   * 被用户译名覆盖掉的内置名。它不参与显示，只进索引 ——
   * 这样用户改了译名之后，数据库里还存着旧译名的历史数据依然能解析回这条实体。
   */
  legacyNames?: Record<string, string>
}

/** 规范化：NFC + 折叠空白 + 去首尾 + 转小写。只用于索引与 key，不改写入的原串 */
export function normalizeTagString(input: string): string {
  return input.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 「某源返回的原串」的索引签名 */
function srcSignature(provider: string, raw: string): string {
  return `${provider || 'src'}:${normalizeTagString(raw)}`
}

/** 「某源自己的稳定 id」的索引签名。`#` 前缀把 id 空间与串空间分开，避免偶然撞键 */
function idSignature(provider: string, id: string): string {
  return `${provider || 'src'}:#${normalizeTagString(id)}`
}

/** 语言的主代码：zh-Hans -> zh */
export function baseLanguage(lang: string): string {
  return (lang.split('-')[0] ?? '').toLowerCase()
}

export function isInternalKey(value: string): boolean {
  return value.startsWith(INTERNAL_KEY_PREFIX)
}

/** 去掉 key 的 `@命名空间:` 前缀，作为显示无路可退时的最后兜底 */
export function stripKeyPrefix(key: string): string {
  if (!isInternalKey(key)) return key
  const at = key.indexOf(':')
  return at === -1 ? key : key.slice(at + 1) || key
}

/** 用户手工铸造的标签所用的命名空间（详情页手写标签时 `ensure-many` 传的 provider） */
const USER_TAG_NAMESPACE = 'user'

/** 中性 key 的命名空间 —— 里面不出现任何源名 */
const NEUTRAL_KEY_NAMESPACE = 'tag'

/** 哈希取多少位十六进制（48 bit，三千条实体下碰撞概率可忽略） */
const NEUTRAL_KEY_HASH_LENGTH = 12

/**
 * 铸造**中性 key**：`@tag:<sha1 前 12 位>`，哈希的输入是「源 + 该源的稳定标识」。
 *
 * 为什么不把源名直接拼进 key（`@vndb:g82` 那种）：**一条实体是跨源的** —— vndb 的 `g82`
 * 和 dlsite 的 `genre:176` 会被归并成同一条，把首个铸它的源写进 key 会让人误以为这条
 * 「属于」那个源（实测用户就这么质疑过）。key 应该只是个不透明的标识。
 *
 * 为什么不用随机 UUID：内置表是**虚拟的**（`getBuiltinTags()` 现算，3057 条不落盘），
 * 随机 key 必须额外持久化一份「源:id → uuid」映射，而那份映射一丢，游戏文档里存着的 key
 * 就成**永久孤儿**。哈希是**可推导**的：词库文件删了也能重算出同一个 key，
 * 两台设备首次遇到同一个「源:稳定标识」也算出同一个 key（UUID 在这一点上会分裂）。
 *
 * `identity` 必须选该源的**稳定标识**：优先源内 id（`g82` / `genre:288`），没有才退回原串。
 */
function makeNeutralKey(provider: string, identity: string): string {
  const input = `${normalizeTagString(provider) || 'src'}:${normalizeTagString(identity)}`
  const hash = createHash('sha1').update(input).digest('hex').slice(0, NEUTRAL_KEY_HASH_LENGTH)
  return `${INTERNAL_KEY_PREFIX}${NEUTRAL_KEY_NAMESPACE}:${hash}`
}

/** 是否已经是中性 key（`@tag:<hash>`） */
function isNeutralKey(key: string): boolean {
  return key.startsWith(`${INTERNAL_KEY_PREFIX}${NEUTRAL_KEY_NAMESPACE}:`)
}

function providerLanguage(provider: string): string {
  return PROVIDER_LANGUAGE[provider] ?? UNDETERMINED_LANGUAGE
}

/** 只接受「普通对象」的键值对，数组/字符串/数字一律当空处理（用户手改文件时容错） */
function entriesOf(source?: unknown): [string, unknown][] {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return []
  return Object.entries(source as Record<string, unknown>)
}

/** 按 key 合并两个「源 -> 串数组」映射，取并集去重 */
function unionStringMap(
  base?: Record<string, string[]>,
  extra?: Record<string, string[]>
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const source of [base, extra]) {
    for (const [provider, list] of entriesOf(source)) {
      if (!Array.isArray(list)) continue
      const merged = new Set(result[provider] ?? [])
      for (const item of list) {
        if (typeof item === 'string' && item.trim()) merged.add(item)
      }
      result[provider] = Array.from(merged)
    }
  }
  return result
}

/** 按 key 合并两个名字表，后者优先 */
function unionNames(
  base?: Record<string, string>,
  extra?: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const source of [base, extra]) {
    for (const [lang, value] of entriesOf(source)) {
      if (typeof value === 'string' && value.trim()) result[lang] = value
    }
  }
  return result
}

/**
 * 记录是否彻底为空 —— 只有空壳才该从词库文件里删掉。
 *
 * ⚠️ 判定必须覆盖 `names` / `fetchedNames` / `src` / `ids` 四个字段。曾经只看
 * 「`!changed` 且 names 为空」就删，导致「只有 src/ids、没有 names」的跨源线索记录
 * 在第二次扫到同一标签时被删掉（第一次写入、第二次删除），线索永远留不住。
 */
function isEmptyRecord(record: TagLexiconTagRecord): boolean {
  const hasNames = Object.keys(record.names).length > 0
  const hasFetched = Object.keys(record.fetchedNames ?? {}).length > 0
  const hasSrc = Object.values(record.src ?? {}).some((list) => list.length > 0)
  const hasIds = Object.values(record.ids ?? {}).some((list) => list.length > 0)
  return !hasNames && !hasFetched && !hasSrc && !hasIds
}

/** 改挂/断开在「参数不完整」时的空结果（调用方据此判断什么都没做） */
function emptyMoveResult(): TagLexiconMoveSourceResult {
  return { moved: { src: [], ids: [] }, blocked: { src: [], ids: [] }, sourceIsShell: false }
}

function emptyRemoveResult(): TagLexiconRemoveSourceResult {
  return { detached: { src: [], ids: [] }, blocked: { src: [], ids: [] }, sourceIsShell: false }
}

/** 空文件：每次返回新对象，避免多处共享同一个可变实例 */
function createEmptyFile(): TagLexiconFile {
  return {
    version: LEXICON_VERSION,
    fallback: [...DEFAULT_FALLBACK],
    tags: {},
    redirects: {},
    conflicts: []
  }
}

/**
 * 冲突的稳定标识：`kind|实体|语言|源|对方|名字`。
 *
 * 刻意做成可读的拼接串（而不是哈希）：冲突是给人处理的东西，调试时能一眼看出是哪一条。
 * 同样的元组永远得到同样的 id，所以重复扫描只会刷新既有记录、不会堆出重复项。
 */
function conflictIdOf(conflict: {
  kind: string
  key: string
  lang: string
  provider: string
  other?: string
  incoming: string
}): string {
  return [
    conflict.kind,
    conflict.key,
    conflict.lang,
    conflict.provider,
    conflict.other ?? '',
    conflict.incoming
  ].join('|')
}

/**
 * 该实体在「这个语言」下的名字（含同语族变体）。
 *
 * 归到语族是为了中文：DLsite 的 `zh-CN` 与词库里的 `zh-Hans` 是同一套写法，
 * 简繁之间的字符串常常完全一样，只比精确语言会漏掉真正的撞名。
 */
function nameInLanguage(tag: EffectiveTag | undefined, lang: string, value: string): boolean {
  if (!tag) return false
  const base = baseLanguage(lang)
  for (const [code, name] of Object.entries(tag.names)) {
    if (name === value && baseLanguage(code) === base) return true
  }
  return false
}

/**
 * 一条用户记录是否体现了「相对于内置表的实质改动」。
 *
 * 只看名字：src / ids 线索既可能是用户手工登记的跨源写法，也可能是扫描时自动记下来的，
 * 若把它们也算作改动，一次正常扫描就会让成百上千条内置标签在管理页变成「自定义」。
 */
function isUserTouched(builtin: EffectiveTag | undefined, record: TagLexiconTagRecord): boolean {
  if (!builtin) return true
  return Object.entries(record.names).some(([lang, value]) => builtin.names[lang] !== value)
}

let builtinCache: Map<string, TagLexiconTagRecord> | null = null
let builtinSourceKeysCache: Set<string> | null = null
let builtinNameIdCache: Map<string, string> | null = null

/**
 * 「名字（主名 / 别名，均 normalize 过）→ vndb 稳定 id」。
 *
 * 内置表的 key 用 vndb 的 `g<数字>` id 铸造（见 `getBuiltinTags()`），所以从「一个名字」
 * 反查「它现在属于哪条实体」需要这层映射。两个用途：
 * 1. 社区中文对照表的键可能对不上官方主名（vndb 改过名，旧名降级成别名）——
 *    靠它才能把中文名挂到现主名那条实体上，而不是新铸一条。
 * 2. `migrateLegacyKeys()` 把 `@vndb:<旧主名>` 这类老 key 并到新的中性 key 上。
 *
 * 先到先得：官方 dump 里主名与别名不会撞（实测「别名恰好是另一个 tag 的当前主名」= 0 条）。
 */
function getBuiltinNameToId(): Map<string, string> {
  if (builtinNameIdCache) return builtinNameIdCache
  const map = new Map<string, string>()
  for (const [rawName, id, aliases] of VNDB_OFFICIAL_TAGS) {
    const name = rawName.trim()
    if (!name || !id) continue
    const main = normalizeTagString(name)
    if (main) map.set(main, id)
    for (const alias of aliases) {
      const key = normalizeTagString(alias)
      if (key && !map.has(key)) map.set(key, id)
    }
  }
  builtinNameIdCache = map
  return map
}

/**
 * 内置表转成虚拟实体。两个来源合并：
 *
 * 1. vndb 官方 tag dump（tags-official.ts）：主名 + 别名 + tag id。
 *    别名是「抗改名」的关键 —— vndb 重命名 tag 时旧名会转成别名（实测 `Yuri` 已成为
 *    `Lesbian Sex` 的别名），把别名一并登记进 src 后，历史数据里的旧名照样命中当前实体。
 *    含假名的别名同时登记成 `names.ja` —— 这是内置表里**唯一的**日文显示名来源
 *    （3014 个 tag 命中 53 个），否则选日语时只会看到回退来的英文。
 * 2. 社区中文对照表（tags-zh.ts）：补 zh-Hans 显示名；表里官方 dump 已不存在的旧 tag
 *    也保留下来，否则历史数据会失去中文名、并在下次扫描时被重新铸成新实体。
 *
 * 懒构建 + 缓存，约 3000 条只算一次。
 */
function getBuiltinTags(): Map<string, TagLexiconTagRecord> {
  if (builtinCache) return builtinCache
  const tags = new Map<string, TagLexiconTagRecord>()
  const aliasToName = new Map<string, string>()

  for (const [rawName, id, aliases] of VNDB_OFFICIAL_TAGS) {
    const name = rawName.trim()
    if (!name) continue
    const src = [name]
    /** 该 tag 第一条含假名的别名，作为日文显示名（见 JAPANESE_KANA 的说明） */
    let japanese: string | undefined
    for (const alias of aliases) {
      const trimmed = alias.trim()
      if (!trimmed || trimmed === name) continue
      src.push(trimmed)
      if (!japanese && JAPANESE_KANA.test(trimmed)) japanese = trimmed
      const normalized = normalizeTagString(trimmed)
      if (normalized && !aliasToName.has(normalized)) aliasToName.set(normalized, name)
    }
    const chinese = VNDB_TAG_ZH[name]?.trim()
    const names: Record<string, string> = { en: name }
    if (chinese) names['zh-Hans'] = chinese
    // ⚠️ 取「第一条假名别名」是启发式：vndb 的别名顺序大体把最通行的写法放前面，
    // 但个别 tag 的首条是变体而非正名（Hanafuda 的首条是 `こいこい`，正名 `花札`
    // 落在纯汉字别名里、无法自动认定）。少数不准的译名在管理页直接改即可。
    // 英日混合的别名再过一道 japaneseCore 收敛（如 `Male on 男の娘` -> `男の娘`）。
    if (japanese) names.ja = japaneseCore(japanese)
    const record: TagLexiconTagRecord = { names, src: { vndb: src } }
    if (id) record.ids = { vndb: [id] }
    // key 用**中性哈希**（`@tag:<hash('vndb:g1544')>`），源名与稳定 id 都不出现在 key 里：
    // 源名会让人误以为这条"属于"该源（而它常是跨源共享的），主名会随 vndb 改名而失效
    // （实测 dump 里 471 条别名与主名只差拼写/连字符，如 `Coodere Hero` → `Kuudere Hero`）。
    // 哈希输入用 vndb 的稳定 id，改名不影响；id 缺失时才退回主名。
    tags.set(makeNeutralKey('vndb', id || name), record)
  }

  for (const [rawName, chinese] of Object.entries(VNDB_TAG_ZH)) {
    const name = rawName.trim()
    if (!name || typeof chinese !== 'string' || !chinese.trim()) continue
    // 中文表里有两种「对不上官方主名」的键：vndb 改过名、旧名已降级成别名（如
    // Coodere Hero -> Kuudere Hero），以及 vndb 已经删掉的 tag。前者先归一到现主名，
    // 后者才自己成为一条实体，否则同一个概念会在词库里留下两条。
    const canonical = aliasToName.get(normalizeTagString(name)) ?? name
    // 官方 dump 里查得到 → 用它的稳定 id 算中性 key（与上面的规则一致）；
    // 查不到说明这个 tag 已被 vndb 删除，只能退回用名字
    const canonicalId = getBuiltinNameToId().get(normalizeTagString(canonical))
    const key = makeNeutralKey('vndb', canonicalId ?? canonical)
    const existing = tags.get(key)
    if (existing) {
      existing.names['zh-Hans'] ??= chinese.trim()
      const rawList = existing.src?.vndb
      if (rawList && !rawList.includes(name)) rawList.push(name)
      continue
    }
    tags.set(key, { names: { en: canonical, 'zh-Hans': chinese.trim() }, src: { vndb: [name] } })
  }

  builtinCache = tags
  return tags
}

/**
 * 内置表已经覆盖的源线索集合（`vndb:yuri` / `vndb:#g82`）。
 *
 * 扫描时命中的原串或源 id 若已经在这里，就不必再写进用户词库文件 ——
 * 官方 dump 有 3945 条别名，逐条落盘会让用户文件白白膨胀十倍，
 * 而且下次升级内置表时这些冗余数据反而会挡住新值。
 */
function getBuiltinSourceKeys(): Set<string> {
  if (builtinSourceKeysCache) return builtinSourceKeysCache
  const keys = new Set<string>()
  for (const record of getBuiltinTags().values()) {
    for (const [provider, list] of Object.entries(record.src ?? {})) {
      for (const raw of list) keys.add(srcSignature(provider, raw))
    }
    for (const [provider, list] of Object.entries(record.ids ?? {})) {
      for (const id of list) keys.add(idSignature(provider, id))
    }
  }
  builtinSourceKeysCache = keys
  return keys
}

/** 把 v1 的「原文 -> 译文」翻译表迁移成 v2 实体表 */
function migrateV1(raw: Record<string, unknown>): TagLexiconFile {
  const idByRaw = new Map<string, string>()
  const rawIdIndex = raw.idIndex
  if (rawIdIndex && typeof rawIdIndex === 'object') {
    for (const [id, name] of Object.entries(rawIdIndex as Record<string, unknown>)) {
      if (typeof name === 'string' && name.trim()) idByRaw.set(name.trim(), String(id).trim())
    }
  }

  const tags: Record<string, TagLexiconTagRecord> = {}
  const languages = raw.languages
  if (languages && typeof languages === 'object') {
    for (const [lang, table] of Object.entries(languages as Record<string, unknown>)) {
      if (!table || typeof table !== 'object') continue
      for (const [sourceKey, value] of Object.entries(table as Record<string, unknown>)) {
        // v1 的词库只服务 vndb 标签，所以这里把 key 一律归到 vndb；v1 的 key 就是 vndb 的英文原名。
        const rawName = sourceKey.trim()
        if (!rawName || typeof value !== 'string' || !value.trim()) continue
        const key = makeNeutralKey(
          'vndb',
          getBuiltinNameToId().get(normalizeTagString(rawName)) ?? rawName
        )
        const record = (tags[key] ??= { names: {} })
        record.names[lang] = value.trim()
        record.names.en ??= rawName
        const src = (record.src ??= {})
        src.vndb = Array.from(new Set([...(src.vndb ?? []), rawName]))
        // v1 的 idIndex 是「vndb 标签 id -> 原文」，转成实体的 ids 线索，
        // 这样以后 vndb 改了标签英文名，仍能靠 id 命中同一条实体。
        const id = idByRaw.get(rawName)
        if (id) {
          const ids = (record.ids ??= {})
          ids.vndb = Array.from(new Set([...(ids.vndb ?? []), id]))
        }
      }
    }
  }

  log.info(`[TagLexicon] Migrated v1 lexicon to v2 (${Object.keys(tags).length} tags)`)
  return {
    version: LEXICON_VERSION,
    fallback: [...DEFAULT_FALLBACK],
    tags,
    redirects: {},
    conflicts: []
  }
}

/** 结构校验冲突列表；顺带丢掉缺字段/重复的条目（id 相同只留第一条） */
function sanitizeConflicts(input: unknown): TagLexiconConflict[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: TagLexiconConflict[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const kind = record.kind === 'duplicate' || record.kind === 'name' ? record.kind : null
    const key = typeof record.key === 'string' ? record.key.trim() : ''
    const lang = typeof record.lang === 'string' ? record.lang.trim() : ''
    const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
    const incoming = typeof record.incoming === 'string' ? record.incoming : ''
    if (!kind || !key || !lang || !provider || !incoming) continue

    const other = typeof record.other === 'string' && record.other.trim() ? record.other : undefined
    const id = conflictIdOf({ kind, key, lang, provider, other, incoming })
    if (seen.has(id)) continue
    seen.add(id)

    out.push({
      id,
      kind,
      key,
      lang,
      provider,
      incoming,
      ...(other ? { other } : {}),
      ...(typeof record.current === 'string' ? { current: record.current } : {}),
      ...(record.currentOrigin === 'builtin' ||
      record.currentOrigin === 'user' ||
      record.currentOrigin === 'fetched'
        ? { currentOrigin: record.currentOrigin }
        : {}),
      ...(Array.isArray(record.ids)
        ? {
            ids: (record.ids as unknown[]).filter(
              (value): value is string => typeof value === 'string' && !!value.trim()
            )
          }
        : {}),
      status: record.status === 'ignored' ? 'ignored' : 'pending',
      at: typeof record.at === 'string' && record.at.trim() ? record.at : new Date().toISOString()
    })
  }
  return out
}

/** 结构校验：剔除非法值，保证任何残缺/手改过的文件都不会让程序崩掉 */
function sanitizeFile(input: unknown): TagLexiconFile {
  const source = input as Record<string, unknown> | null
  if (!source || typeof source !== 'object') return createEmptyFile()
  if (source.version === LEXICON_VERSION && source.tags && typeof source.tags === 'object') {
    const tags: Record<string, TagLexiconTagRecord> = {}
    for (const [key, value] of Object.entries(source.tags as Record<string, unknown>)) {
      if (!key.trim() || !value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      // ⚠️ 这里是**白名单**：TagLexiconTagRecord 加了字段必须同时加到这里，
      // 否则字段会在读文件时被静默丢掉（写进去、读回来就没了，且不报错）。
      const names = unionNames(record.names as Record<string, string> | undefined)
      const fetchedNames = unionNames(record.fetchedNames as Record<string, string> | undefined)
      const src = unionStringMap(record.src as Record<string, string[]> | undefined)
      const ids = unionStringMap(record.ids as Record<string, string[]> | undefined)
      // 只登记了「跨源等价写法」而没有译名的记录同样有意义（手工归并时就是这个形态），不能丢
      if (
        Object.keys(names).length === 0 &&
        Object.keys(fetchedNames).length === 0 &&
        Object.keys(src).length === 0 &&
        Object.keys(ids).length === 0
      ) {
        continue
      }
      const tag: TagLexiconTagRecord = { names }
      if (Object.keys(fetchedNames).length > 0) tag.fetchedNames = fetchedNames
      if (Object.keys(src).length > 0) tag.src = src
      if (Object.keys(ids).length > 0) tag.ids = ids
      tags[key] = tag
    }

    const redirects: TagLexiconFile['redirects'] = {}
    if (source.redirects && typeof source.redirects === 'object') {
      for (const [from, value] of Object.entries(source.redirects as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') continue
        const record = value as Record<string, unknown>
        if (typeof record.to !== 'string' || !record.to.trim()) continue
        redirects[from] = {
          to: record.to,
          ...(record.at && typeof record.at === 'string' ? { at: record.at } : {}),
          ...(record.backup && typeof record.backup === 'object'
            ? { backup: record.backup as TagLexiconTagRecord }
            : {})
        }
      }
    }

    const fallback = Array.isArray(source.fallback)
      ? (source.fallback as unknown[]).filter(
          (item): item is string => typeof item === 'string' && !!item.trim()
        )
      : []
    return {
      version: LEXICON_VERSION,
      fallback: fallback.length > 0 ? fallback : [...DEFAULT_FALLBACK],
      tags,
      redirects,
      conflicts: sanitizeConflicts(source.conflicts)
    }
  }

  // v1：{ version: 1, languages: { lang: { 原文: 译文 } }, idIndex?: { id: 原文 } }
  if (source.languages && typeof source.languages === 'object') return migrateV1(source)
  return createEmptyFile()
}

export class TagLexiconManager {
  private static instance: TagLexiconManager | null = null
  private filePath: string
  private data: TagLexiconFile = createEmptyFile()
  private effective = new Map<string, EffectiveTag>()
  private nameIndex = new Map<string, string>()
  private srcIndex = new Map<string, string>()
  private idIndex = new Map<string, string>()
  private redirectIndex = new Map<string, string>()
  private watching = false
  /** 上次自行写入的时间戳，用于忽略自己触发的文件变更 */
  private lastWriteAt = 0
  /** 载入时发现文件是旧版本号；非 null 表示需要回写升级 */
  private upgradeFrom: number | null = null
  /** 上次推送给渲染层的待处理冲突数，避免同一状态重复发事件 */
  private notifiedConflictCount = -1
  /** `rebuild()` 里 prune 掉过冲突（纯内存），启动/重载后需要补一次落盘 */
  private conflictsPruned = false

  private constructor(filePath: string) {
    this.filePath = filePath
    this.loadSync()
    this.rebuild()
    this.flushPrunedConflicts()
    this.maybeUpgradeFile()
    this.startWatching()
  }

  static getInstance(): TagLexiconManager {
    if (!TagLexiconManager.instance) {
      TagLexiconManager.instance = new TagLexiconManager(getDataPath('tag-lexicon.json'))
    }
    return TagLexiconManager.instance
  }

  getPath(): string {
    return this.filePath
  }

  /**
   * 同步读取词库文件。
   * 必须同步：resolve / display 都是同步函数（抓取归一与渲染层显示映射都会同步调用），
   * 不能在首次使用时 await，所以构造时就同步读盘并常驻内存。
   * 文件通常只有几十 KB，一次同步读取成本可忽略；写回仍走异步。
   */
  private loadSync(): void {
    try {
      if (!fse.existsSync(this.filePath)) {
        fse.ensureDirSync(path.dirname(this.filePath))
        this.data = createEmptyFile()
        fse.writeFileSync(this.filePath, this.serialize(), 'utf-8')
        log.info(`[TagLexicon] Created empty lexicon at ${this.filePath}`)
        return
      }
      const raw = fse.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      this.upgradeFrom = parsed?.version === LEXICON_VERSION ? null : Number(parsed?.version ?? 1)
      this.data = sanitizeFile(parsed)
      // key 规则变更后的老记录，就地并到新的中性 key 上
      if (this.migrateLegacyKeys()) {
        // loadSync 是同步上下文，这里直接同步写回，并刷新 lastWriteAt
        // —— 否则自己的 watcher 会把这次写入当成「外部改动」再触发一次 reload
        fse.writeFileSync(this.filePath, this.serialize(), 'utf-8')
        this.lastWriteAt = Date.now()
        log.info('[TagLexicon] Lexicon file rewritten after legacy key migration')
      }
    } catch (error) {
      log.error('[TagLexicon] Failed to load lexicon, fallback to empty:', error)
      this.data = createEmptyFile()
      this.upgradeFrom = null
    }
  }

  /** 文件是旧版本号时，备份后回写成当前版本（破坏性格式变更的安全网） */
  private maybeUpgradeFile(): void {
    const from = this.upgradeFrom
    if (from === null) return
    this.upgradeFrom = null
    void this.upgradeFile(from)
  }

  /** 把旧版本文件备份后回写成当前版本 */
  private async upgradeFile(from: number): Promise<void> {
    try {
      await fse.copy(this.filePath, `${this.filePath}.v${from}.bak`)
      await this.persist()
      log.info(`[TagLexicon] Upgraded lexicon file v${from} -> v${LEXICON_VERSION}`)
    } catch (error) {
      log.error('[TagLexicon] Failed to upgrade lexicon file:', error)
    }
  }

  /** 从磁盘重新载入（用户在外部编辑器改完文件后调用） */
  reload(): void {
    this.loadSync()
    this.rebuild()
    this.flushPrunedConflicts()
    this.maybeUpgradeFile()
  }

  /**
   * 把 `rebuild()` 里 prune 掉的冲突补写回文件。
   *
   * prune 是纯内存操作，正常情况下下一次写操作会顺带落盘；但启动时读进来的老冲突
   * 如果不补这一次写，就会一直留在文件里 —— UI 看不到它（已被过滤），文件里却还在，
   * 下次打开编辑器看词库会以为冲突没被清掉。
   */
  private flushPrunedConflicts(): void {
    if (!this.conflictsPruned) return
    this.conflictsPruned = false
    void this.persist().catch(() => {
      // persist 内部已经记过日志；这里只是别让未处理的 rejection 冒出去
    })
  }

  /** 监听文件的外部改动，实现「改完文件即生效」；自身写入会被忽略 */
  private startWatching(): void {
    if (this.watching) return
    this.watching = true
    try {
      fs.watchFile(this.filePath, { interval: WATCH_INTERVAL_MS }, () => {
        if (Date.now() - this.lastWriteAt < SELF_WRITE_GRACE_MS) return
        this.reload()
        log.info('[TagLexicon] External change detected, lexicon reloaded')
      })
    } catch (error) {
      log.warn('[TagLexicon] Failed to watch lexicon file:', error)
    }
  }

  private serialize(lang?: string): string {
    // 按语言导出是「拿去翻译/给别人补译名」的场景，冲突是本地编辑状态、不该跟着走；
    // 整库导出（备份/换设备）必须带上，否则「已忽略」这类决定会在恢复后丢失。
    const file = lang
      ? {
          version: LEXICON_VERSION,
          fallback: this.data.fallback,
          tags: Object.fromEntries(
            Object.entries(this.data.tags).filter(([, record]) => !!record.names[lang])
          ),
          redirects: this.data.redirects
        }
      : this.data
    return JSON.stringify(file, null, 2)
  }

  private async persist(): Promise<void> {
    try {
      await fse.ensureDir(path.dirname(this.filePath))
      await fse.writeFile(this.filePath, this.serialize(), 'utf-8')
      this.lastWriteAt = Date.now()
    } catch (error) {
      log.error('[TagLexicon] Failed to save lexicon:', error)
      throw error
    }
  }

  /**
   * 把历史形式的 key 统一换成中性 key（`@tag:<hash>`）。
   *
   * key 规则演进过三代：`@<源>:<原串>` → `@vndb:<稳定 id>` → 现在的 `@tag:<hash>`。
   * 用户词库文件里可能残留任何一代的老 key（规则修改前扫过、导入过别人的词库、
   * 或从别的设备同步过来），不处理的话同一个概念会留下两条实体：内置表那条 +
   * 用户文件里那条孤儿。
   *
   * 做法：对每个非中性 key 算出它现在对应哪个 key，并入目标 + 写 `redirects`
   * （**老 key 照样能解析**）；已有 redirect 里指向老 key 的 `to` 也一并重写。
   * 纯内存操作，调用方负责落盘。
   */
  private migrateLegacyKeys(): boolean {
    let changed = false

    for (const [oldKey, record] of Object.entries(this.data.tags)) {
      const target = this.neutralKeyFor(oldKey)
      if (!target || target === oldKey) continue
      this.absorbRecord(target, record)
      this.data.redirects[oldKey] = { to: target, at: new Date().toISOString() }
      delete this.data.tags[oldKey]
      changed = true
      log.info(`[TagLexicon] Migrated legacy key "${oldKey}" -> "${target}"`)
    }

    // 已有的 redirect 可能还指向老 key，一并重写
    for (const redirect of Object.values(this.data.redirects)) {
      const target = this.neutralKeyFor(redirect.to)
      if (target && target !== redirect.to) {
        redirect.to = target
        changed = true
      }
    }
    return changed
  }

  /** 老 key → 它现在对应的中性 key；已经是中性形式、或推不出来时返回 null */
  private neutralKeyFor(key: string): string | null {
    if (!isInternalKey(key) || isNeutralKey(key)) return null
    const namespace = key.slice(1).split(':')[0] ?? ''
    const local = stripKeyPrefix(key)
    if (!namespace || !local) return null
    // vndb 的老 key 两种形式都出现过：稳定 id（`@vndb:g1544`）和主名（`@vndb:kuudere hero`）。
    // 主名得先换成 id，才能与内置表算出来的 key 对齐。
    if (namespace === 'vndb' && !/^g\d+$/.test(local)) {
      return makeNeutralKey('vndb', getBuiltinNameToId().get(normalizeTagString(local)) ?? local)
    }
    return makeNeutralKey(namespace, local)
  }

  /**
   * 把一条老记录的线索并到目标 key 上。
   *
   * ⚠️ 只搬「内置表没覆盖到的」内容：内置的 src/ids 本来就在内置表里，往用户文件里再抄一份
   * 纯属膨胀（`getBuiltinSourceKeys()` 存在的意义就是这个）。过滤后没剩下任何东西
   * （这条记录全是内置已知的）就什么都不写，只留 redirect。
   */
  private absorbRecord(target: string, record: TagLexiconTagRecord): void {
    const builtinSourceKeys = getBuiltinSourceKeys()
    const src: Record<string, string[]> = {}
    for (const [provider, list] of Object.entries(record.src ?? {})) {
      const kept = list.filter((raw) => !builtinSourceKeys.has(srcSignature(provider, raw)))
      if (kept.length > 0) src[provider] = kept
    }
    const ids: Record<string, string[]> = {}
    for (const [provider, list] of Object.entries(record.ids ?? {})) {
      const kept = list.filter((item) => !builtinSourceKeys.has(idSignature(provider, item)))
      if (kept.length > 0) ids[provider] = kept
    }
    const hasPayload =
      Object.keys(record.names).length > 0 ||
      Object.keys(record.fetchedNames ?? {}).length > 0 ||
      Object.keys(src).length > 0 ||
      Object.keys(ids).length > 0
    if (!hasPayload) return

    const into = (this.data.tags[target] ??= { names: {} })
    into.names = unionNames(into.names, record.names)
    const fetched = unionNames(into.fetchedNames, record.fetchedNames)
    if (Object.keys(fetched).length > 0) into.fetchedNames = fetched
    const mergedSrc = unionStringMap(into.src, src)
    if (Object.keys(mergedSrc).length > 0) into.src = mergedSrc
    const mergedIds = unionStringMap(into.ids, ids)
    if (Object.keys(mergedIds).length > 0) into.ids = mergedIds
  }

  /**
   * 重建「有效实体表」与三个索引。
   * 顺序：内置表打底 -> 用户记录覆盖/补充 -> 重定向的 backup 也挂到目标上。
   */
  private rebuild(): void {
    this.effective.clear()
    this.nameIndex.clear()
    this.srcIndex.clear()
    this.idIndex.clear()
    this.redirectIndex.clear()

    const merged: Record<string, EffectiveTag> = {}
    for (const [key, record] of getBuiltinTags()) {
      merged[key] = {
        key,
        names: { ...record.names },
        src: { ...(record.src ?? {}) },
        ids: { ...(record.ids ?? {}) },
        origin: 'builtin'
      }
    }

    for (const [key, record] of Object.entries(this.data.tags)) {
      const builtin = merged[key]
      // 优先级：用户 names > 内置 names > 抓取自动积累的 fetchedNames。
      // `unionNames(base, extra)` 是 extra 覆盖 base，所以 fetchedNames 放最里层。
      const names = unionNames(record.fetchedNames, unionNames(builtin?.names, record.names))
      const src = unionStringMap(builtin?.src, record.src)
      const ids = unionStringMap(builtin?.ids, record.ids)
      const origin = isUserTouched(builtin, record) ? 'user' : 'builtin'
      merged[key] = { key, names, src, ids, origin, legacyNames: builtin?.names }
    }

    for (const [key, tag] of Object.entries(merged)) {
      this.effective.set(key, tag)
      this.indexTag(key, tag.names, tag.src, tag.ids, tag.legacyNames)
    }

    for (const [from, redirect] of Object.entries(this.data.redirects)) {
      const target = this.followRedirect(redirect.to)
      this.redirectIndex.set(from, target)
      // 手改文件只写了 redirect 没做吸收时，靠 backup 也能反查到目标
      if (redirect.backup && !this.effective.has(from)) {
        this.indexTag(target, redirect.backup.names, redirect.backup.src, redirect.backup.ids)
      }
    }

    if (this.pruneConflicts()) this.conflictsPruned = true
  }

  /**
   * 丢掉已经不需要处理的冲突（纯内存，落盘交给调用方 —— 所以改挂/断开的调用方
   * 必须**先 `rebuild()` 再 `persist()`**，否则这里删掉的记录会留在磁盘上）。
   *
   * 四种情况会失效：
   * 1. 实体没了（被删/被并走）—— 没有东西可以决定了；
   * 2. `name` 冲突的「当前值」已经变了（用户采纳了抓取写法、或在管理页改成了别的）；
   * 3. `duplicate` 冲突的两条已经并成一条（`key` 与 `other` 指向同一实体）；
   * 4. `duplicate` 冲突的新铸实体已经不再持有该 provider 的任何线索（被改挂/断开）——
   *    这条冲突问的是「铸出来这条实体身上的 provider 线索该不该并进 other」，
   *    线索都被挪走了就没有东西可决定。2026-09-24 加：此前用户改挂成功后这条仍挂着，
   *    让人以为操作没生效（「是不是被静默合并了」）。
   *
   * 返回是否真丢掉了记录（调用方据此决定要不要补一次落盘）。
   */
  private pruneConflicts(): boolean {
    const conflicts = this.data.conflicts
    if (!conflicts || conflicts.length === 0) return false

    this.data.conflicts = conflicts.filter((conflict) => {
      // 实体没了（被删、被并走），没有东西可以决定了
      if (!this.effective.has(conflict.key)) return false

      if (conflict.kind === 'duplicate') {
        if (!conflict.other) return false
        const other = this.followRedirect(conflict.other)
        if (!this.effective.has(other)) return false
        // 两条已经并成一条时，这条冲突自己就没了
        if (conflict.key === other) return false
        // 线索已被改挂/断开。已忽略的不动 —— 那是用户自己的决定，别替他清掉。
        if (conflict.status === 'pending' && conflict.provider) {
          return this.hasCluesOf(this.effective.get(conflict.key), conflict.provider)
        }
        return true
      }

      // `name`：只在「当前值还是当初那个值」时继续问。
      // 用户采纳过（值变成 incoming）、或在管理页改成了别的写法，这条冲突都已经过期 ——
      // 继续挂着会让人在「保留 A / 采纳 B」之间选，而 A 早就不是现状了。
      const tag = this.effective.get(conflict.key)
      if (!tag) return false
      if (conflict.current !== undefined) return tag.names[conflict.lang] === conflict.current
      return tag.names[conflict.lang] !== conflict.incoming
    })

    return this.data.conflicts.length !== conflicts.length
  }

  /** 这条实体身上是否还挂着某个源的线索（`src` 或 `ids` 任一非空即算） */
  private hasCluesOf(tag: EffectiveTag | undefined, provider: string): boolean {
    if (!tag) return false
    return (tag.src[provider]?.length ?? 0) > 0 || (tag.ids[provider]?.length ?? 0) > 0
  }

  /** 这条实体现在是不是「空壳」——只剩名字、没有任何来源线索（实体本身消失也算） */
  private isShell(key: string): boolean {
    const tag = this.effective.get(this.followRedirect(key))
    if (!tag) return true
    return Object.keys(tag.src).length === 0 && Object.keys(tag.ids).length === 0
  }

  /**
   * 把一条实体的「名字 / 原始串 / 源 id」登记进索引。
   *
   * 源原始串**同时**进 srcIndex 和 nameIndex：
   * - srcIndex 带 provider 前缀，用于同源精确匹配（优先级最高，不会被别的源抢走）；
   * - nameIndex 不带前缀，是跨源兜底 —— 正因如此，vndb 别名里的「寝取られ」在
   *   erogamescape 返回同一个串时才能命中同一条实体，也就是跨源归并。
   * names 先遍历，所以名字的优先级高于原始串（后写入的不覆盖已存在的键）。
   */
  private indexTag(
    key: string,
    names: Record<string, string>,
    src?: Record<string, string[]>,
    ids?: Record<string, string[]>,
    legacyNames?: Record<string, string>
  ): void {
    // 历史名先写、当前名后写，所以当前名优先命中，旧名仍然可解析
    for (const name of Object.values(legacyNames ?? {})) {
      const normalized = normalizeTagString(name)
      if (normalized) this.nameIndex.set(normalized, key)
    }
    for (const name of Object.values(names ?? {})) {
      const normalized = normalizeTagString(name)
      if (normalized) this.nameIndex.set(normalized, key)
    }
    for (const [provider, list] of Object.entries(src ?? {})) {
      for (const raw of list) {
        const normalized = normalizeTagString(raw)
        if (!normalized) continue
        this.srcIndex.set(srcSignature(provider, raw), key)
        if (!this.nameIndex.has(normalized)) this.nameIndex.set(normalized, key)
      }
    }
    for (const [provider, list] of Object.entries(ids ?? {})) {
      for (const id of list) {
        if (normalizeTagString(id)) this.idIndex.set(idSignature(provider, id), key)
      }
    }
  }

  /** 跟随重定向链，带环保护 */
  private followRedirect(key: string): string {
    let current = key
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      const next = this.redirectIndex.get(current)
      if (!next || next === current) break
      current = next
    }
    return current
  }

  /**
   * 解析：把「抓取源返回的原始串」映射到实体内 key。
   * 只读，不会铸新实体（铸新走 ensureTag）。
   */
  resolve(raw?: string | null, provider?: string, id?: string): string | null {
    const text = (raw ?? '').trim()
    if (!text) return null

    // 传进来就已经是内部 key（例如从数据库里读出来的值）
    if (isInternalKey(text)) {
      const target = this.followRedirect(text)
      if (this.effective.has(target)) return target
      // 老 key 兜底：key 规则换过三代（`@vndb:yuri` → `@vndb:g82` → `@tag:<hash>`）。
      // `migrateLegacyKeys()` 只覆盖「词库文件里有记录」的老 key，而游戏文档里可能存着
      // 我们词库从没记录过的（从别的设备同步过来）。把 key 拆成「命名空间 + 局部名」再查一遍：
      // - 局部名是旧主名 → 名字索引里有（vndb 改名时旧名降级成别名，仍在索引里）
      // - 局部名是源内 id → id 索引里有（`@vndb:g82` / `@dlsite:genre:288`）
      // ⚠️ 中性 key 的局部名是哈希、不可逆，所以**救不回来** —— 这是哈希方案换来的代价
      // （好处是哈希可推导、无需持久化映射，见 makeNeutralKey 的注释）。
      const namespace = text.slice(1).split(':')[0] ?? ''
      const local = stripKeyPrefix(text)
      if (local && local !== text) {
        const normalized = normalizeTagString(local)
        const hit =
          this.nameIndex.get(normalized) ??
          (namespace ? this.idIndex.get(idSignature(namespace, normalized)) : undefined)
        if (hit) {
          const resolved = this.followRedirect(hit)
          if (this.effective.has(resolved)) return resolved
        }
      }
      return null
    }

    const normalized = normalizeTagString(text)
    if (!normalized) return null

    if (provider && id) {
      const byId = this.idIndex.get(idSignature(provider, id))
      if (byId) return this.followRedirect(byId)
    }

    if (provider) {
      const bySource = this.srcIndex.get(srcSignature(provider, normalized))
      if (bySource) return this.followRedirect(bySource)
    }

    // 跨源、跨语言的名字命中：这就是「不同源的同名/同译名标签自动归并」的实现
    const byName = this.nameIndex.get(normalized)
    return byName ? this.followRedirect(byName) : null
  }

  /**
   * 解析并保证存在：未命中时现场铸造实体。
   * 铸造是幂等的（同一「源 + 原串」永远得到同一个 key），所以多设备/并发扫描不会分叉。
   *
   * `lang` 指定铸造时登记的显示名语言：手工输入的标签没有「源语言」，
   * 由调用方传当前界面语言；不传则按 provider 的默认语言（见 PROVIDER_LANGUAGE）。
   */
  async ensureTag(raw: string, provider: string, id?: string, lang?: string): Promise<string> {
    const text = raw.trim()
    if (!text) throw new Error('Empty tag name')

    const { key, mutated } = this.resolveOrMint(text, provider, id, lang)
    if (mutated) {
      await this.persist()
      this.rebuild()
      this.notifyConflictChange()
    }
    return key
  }

  /**
   * 批量解析并保证存在，整批只落盘、只重建一次索引。
   *
   * 逐个调用 ensureTag 时每次都要重写文件并重建 3000+ 条实体的索引，
   * 一个游戏几十个标签会明显拖慢扫描，所以抓取链路一律走这个批量入口。
   *
   * `idByRaw` 是「原始串 → 源内稳定 id」的映射（只含**有**稳定 id 的标签，见
   * `GameMetadata.tagIds`）。它对**文本随语言变**的源是必需的：DLsite 中文站返回
   * 「主从/主仆」、日文站返回「主従」，只有 `/genre/288/` 这个 id 两语言一致，
   * 靠它才能让两种写法落到同一条实体上。
   */
  async ensureTags(
    raws: readonly string[],
    provider: string,
    lang?: string,
    idByRaw?: ReadonlyMap<string, string>
  ): Promise<string[]> {
    let mutated = false
    const keys: string[] = []
    for (const raw of raws) {
      const text = (raw ?? '').trim()
      if (!text) continue
      const result = this.resolveOrMint(text, provider, idByRaw?.get(text), lang)
      if (result.mutated) mutated = true
      keys.push(result.key)
    }
    if (mutated) {
      await this.persist()
      this.rebuild()
      this.notifyConflictChange()
    }
    return keys
  }

  /**
   * 同步的「解析 -> 命中则登记线索 / 未命中则铸造」，只改内存不落盘。
   * 铸造是幂等的（同一「源 + 稳定 id」永远得到同一个 key），所以多设备/并发扫描不会分叉。
   *
   * **有源内稳定 id 时只认 id**：命中就用它，没命中直接按 id 铸新实体，
   * 不再退到「按源原始串 / 跨源名字」的文本归并。这是 2026-09-24 的刻意改动 ——
   * 文本归并会静默地把**不同概念**并成一条：DLsite 的作品形式「角色扮演」
   * （`type:RPG`，指 RPG 游戏类型）撞上了 vndb `Cosplay` 的中文译名「角色扮演」，
   * 一旦并进去 `ids.dlsite:['type:RPG']` 就固化在 Cosplay 上，之后每次抓取都沿错，
   * 还会把 Cosplay 的日文名污染成「ロールプレイング」。同类写法到底是不是同一个概念，
   * 只有人看得出来（`兽耳` = vndb `Kemonomimi` 是真同义，`角色扮演` 是假同义），
   * 所以撞名不再自动处理，改为记一条 `duplicate` 冲突交给「冲突管理」。
   *
   * 没有稳定 id 的源（vndb / bangumi / steam…）保持文本归并：这些源的标签语言固定，
   * 原文本身就是稳定标识，且它们的 id 也拿不到。
   */
  private resolveOrMint(
    raw: string,
    provider: string,
    id?: string,
    lang?: string
  ): { key: string; mutated: boolean } {
    const namespace = provider || 'src'
    const stableId = id?.trim()

    if (stableId) {
      const byId = this.idIndex.get(idSignature(namespace, stableId))
      if (byId) {
        const key = this.followRedirect(byId)
        if (this.effective.has(key)) {
          return { key, mutated: this.rememberSource(key, namespace, raw, stableId, lang) }
        }
      }
      return this.mintTag(raw, namespace, stableId, lang)
    }

    const bySource = this.srcIndex.get(srcSignature(namespace, raw))
    if (bySource) {
      const key = this.followRedirect(bySource)
      if (this.effective.has(key)) {
        return { key, mutated: this.rememberSource(key, namespace, raw, undefined, lang) }
      }
    }

    // 跨源、跨语言的名字命中：这就是「不同源的同名/同译名标签自动归并」的实现
    const byName = this.nameIndex.get(normalizeTagString(raw))
    if (byName) {
      const key = this.followRedirect(byName)
      if (this.effective.has(key)) {
        return { key, mutated: this.rememberSource(key, namespace, raw, undefined, lang) }
      }
    }

    return this.mintTag(raw, namespace, undefined, lang)
  }

  /**
   * 铸一条新实体。key 用**中性哈希**（`@tag:<hash>`）：源名不进 key，稳定标识只作为哈希输入。
   *
   * 有稳定 id 时必须用它算 key —— 文本是「抓取那一刻的界面语言」的产物（DLsite 中文站给
   * 「傲娇」、日文站给「ツンデレ」），拿文本算 key 会让 key 随语言漂，换个语言重扫或
   * 重建词库后，游戏文档里存的旧 key 就成了孤儿。没有 id 才退回原串（语言固定的源够用）。
   */
  private mintTag(
    raw: string,
    namespace: string,
    id: string | undefined,
    lang: string | undefined
  ): { key: string; mutated: boolean } {
    const key = makeNeutralKey(namespace, id ?? raw)
    if (this.data.tags[key]) {
      // 索引没命中但记录已经存在（例如名字被手改过），补线索后复用
      return { key, mutated: this.rememberSource(key, namespace, raw, id, lang) }
    }

    const target = (lang?.trim() || providerLanguage(namespace)).trim()
    const record: TagLexiconTagRecord = {
      names: target ? { [target]: raw } : {},
      src: { [namespace]: [raw] }
    }
    if (id) record.ids = { [namespace]: [id] }
    this.data.tags[key] = record

    // 新铸的这条可能在同一个语言下已经与别的实体同名（`兽耳` / `角色扮演` 都属于这种）。
    // 这里只**记录**，不合并 —— 是不是同一个概念要人来判断。
    this.recordDuplicateConflict(key, namespace, raw, target, id)

    log.info(`[TagLexicon] Minted tag "${key}" from ${namespace}:${raw}`)
    return { key, mutated: true }
  }

  /**
   * 记录「新铸实体与已有实体在某个语言下同名」的冲突。
   *
   * 判据是「对方在**这个语言**下的名字恰好等于抓到的写法」——只比精确语言会漏掉中文的
   * 简繁写法（`zh-CN` 与 `zh-Hans` 常常同串），所以用 `nameInLanguage` 按语族比。
   * 索引是上一轮 `rebuild()` 的快照，所以「同一批里先后铸出来的两条同名」不会被误报。
   */
  private recordDuplicateConflict(
    key: string,
    provider: string,
    raw: string,
    lang: string,
    id?: string
  ): void {
    if (!lang || lang === UNDETERMINED_LANGUAGE) return
    const matched = this.nameIndex.get(normalizeTagString(raw))
    if (!matched) return
    const other = this.followRedirect(matched)
    if (other === key) return
    const target = this.effective.get(other)
    if (!target || !nameInLanguage(target, lang, raw)) return

    this.recordConflict({
      kind: 'duplicate',
      key,
      lang,
      provider,
      incoming: raw,
      other,
      ...(id ? { ids: [id] } : {})
    })
  }

  /** 插入或刷新一条冲突记录：同 id 只保留一条，并**保留已有的 `ignored` 状态** */
  private recordConflict(input: Omit<TagLexiconConflict, 'id' | 'at' | 'status'>): boolean {
    const id = conflictIdOf(input)
    const conflicts = (this.data.conflicts ??= [])
    const existing = conflicts.find((item) => item.id === id)
    if (existing) {
      // 只刷可能变化的部分；`status` 必须留着 —— 用户忽略过的写法不该因为再扫一遍就复活
      existing.current = input.current ?? existing.current
      existing.currentOrigin = input.currentOrigin ?? existing.currentOrigin
      existing.ids = input.ids ?? existing.ids
      existing.at = new Date().toISOString()
      return false
    }
    conflicts.push({ ...input, id, status: 'pending', at: new Date().toISOString() })
    return true
  }

  /**
   * 在内存里记录新出现的「源 / 原始串 / 源 id」线索，已有或已由内置表覆盖则跳过。
   * 返回是否真的产生了新线索（调用方据此决定要不要落盘）。
   *
   * 顺带把「当前语言的名字」补进 `fetchedNames`（缺才补、不覆盖已有）——
   * 这是跨语言归并真正能攒出译名的地方：DLsite 中文站给「主从/主仆」、日文站给「主従」，
   * 两边靠 `genre:288` 归并到同一实体后，就自动变成这条实体的两个语言名。
   */
  private rememberSource(
    key: string,
    provider: string,
    raw: string,
    id?: string,
    lang?: string
  ): boolean {
    const record = (this.data.tags[key] ??= { names: {} })
    const builtinKeys = getBuiltinSourceKeys()
    let changed = false

    if (!builtinKeys.has(srcSignature(provider, raw))) {
      const list = ((record.src ??= {})[provider] ??= [])
      if (!list.includes(raw)) {
        list.push(raw)
        changed = true
      }
    }

    if (id && !builtinKeys.has(idSignature(provider, id))) {
      const list = ((record.ids ??= {})[provider] ??= [])
      if (!list.includes(id)) {
        list.push(id)
        changed = true
      }
    }

    // 补「当前语言的名字」：数据里没有该语言的名字就记下来。
    // 判定要看**合并后的生效值** —— 内置或用户已经给了这个语言的名字时不能覆盖
    // （否则 `@vndb:g753` 的 zh-Hans「兽耳」会被 DLsite 的写法顶掉）。
    // 写进 `fetchedNames` 而不是 `names`：这不是用户编辑的，混进 `names` 会让内置实体
    // 被 `isUserTouched` 判成 user（「内置」徽标消失、userCount 虚涨），
    // 也会被 `exportUser` 当作用户译名导出去。详见 TagLexiconTagRecord 的注释。
    //
    // ⚠️ 该语言**已经有别的名字**时，以前是静默跳过（抓到的写法只进 src）。现在记一条
    // `name` 冲突交给「冲突管理」：最有价值的场景是「用户手改过译名，之后扫描又抓到别的写法」，
    // 静默跳过等于让用户永远不知道源头和词库不一致。注意抓到的写法本来就会进 `src`，
    // 所以「保留现状」这一侧不用再写任何东西（旧写法照样能解析）。
    const target = (lang?.trim() || providerLanguage(provider)).trim()
    if (target && target !== UNDETERMINED_LANGUAGE) {
      const own = record.names[target]
      const fetched = record.fetchedNames?.[target]
      const effective = own ?? fetched ?? this.effective.get(key)?.names?.[target]
      if (effective === undefined) {
        ;(record.fetchedNames ??= {})[target] = raw
        changed = true
      } else if (effective !== raw) {
        this.recordConflict({
          kind: 'name',
          key,
          lang: target,
          provider,
          incoming: raw,
          current: effective,
          currentOrigin: own !== undefined ? 'user' : fetched !== undefined ? 'fetched' : 'builtin',
          ...(id ? { ids: [id] } : {})
        })
      }
    }

    // 一条线索都没有的记录别留在文件里（判定要连已有的 src/ids/fetchedNames 一起看，
    // 只看 `changed` 会误删「只有线索、没有译名」的记录，详见 isEmptyRecord）
    if (isEmptyRecord(record)) delete this.data.tags[key]
    return changed
  }

  /**
   * 登记「某源的某个原始串 / 源 id 等价于这条实体」，用于手工跨源映射：
   * 例如把 ErogameScape 的日文「寝取られ」挂到 vndb 的 `Netorare` 上，
   * 之后扫描 erogamescape 的标签就会直接落在这条实体上，不会再铸出重复条目。
   * 与自动铸造不同，这里显式绕过内置线索判断 —— 用户明确登记的关系必须写进文件。
   */
  async addSource(key: string, provider: string, raw: string, id?: string): Promise<void> {
    const namespace = provider.trim()
    const text = raw.trim()
    if (!namespace || !text) return
    const target = this.followRedirect(key)
    if (!this.effective.has(target)) return

    const record = (this.data.tags[target] ??= { names: {} })
    let changed = false

    const list = ((record.src ??= {})[namespace] ??= [])
    if (!list.includes(text)) {
      list.push(text)
      changed = true
    }

    if (id) {
      const idList = ((record.ids ??= {})[namespace] ??= [])
      if (!idList.includes(id)) {
        idList.push(id)
        changed = true
      }
    }

    if (!changed) return
    await this.persist()
    this.rebuild()
    log.info(`[TagLexicon] Registered ${namespace}:${text} as an alias of "${target}"`)
  }

  /**
   * 显示名解析：精确命中 -> 同语族变体 -> 全局 fallback 链 -> 任意可用名 -> 剥前缀的 key。
   * 永远不直接把 key 当显示名（除非实体连一个名字都没有）。
   */
  display(key: string, lang: string): string {
    const target = this.followRedirect(key)
    const record = this.effective.get(target)
    if (!record) return stripKeyPrefix(target)

    const names = record.names
    const exact = names[lang]
    if (exact) return exact

    const base = baseLanguage(lang)
    for (const [code, value] of Object.entries(names)) {
      if (value && baseLanguage(code) === base) return value
    }
    for (const code of this.data.fallback) {
      const value = names[code]
      if (value) return value
    }
    const any = Object.values(names).find((value) => !!value)
    return any ?? stripKeyPrefix(target)
  }

  /**
   * 批量取显示名。传入的可以是实体 key，也可以是数据库里的旧值（迁移前的原文），
   * 内部先 resolve 再 display —— 所以中文旧值、vndb 改名前的英文旧名都能正确映射。
   * 完全认不出来的值原样返回，因此对尚未迁移的老数据没有任何副作用。
   */
  displayMap(lang: string, keys?: string[]): Record<string, string> {
    const result: Record<string, string> = {}
    const source = keys && keys.length > 0 ? keys : Array.from(this.effective.keys())
    for (const key of source) {
      const target = this.resolve(key)
      result[key] = target ? this.display(target, lang) : key
    }
    return result
  }

  private toEntity(tag: EffectiveTag, lang: string): TagLexiconEntity {
    return {
      key: tag.key,
      display: this.display(tag.key, lang),
      names: { ...tag.names },
      src: { ...tag.src },
      ids: { ...tag.ids },
      origin: tag.origin
    }
  }

  /**
   * 搜索 + 分页。关键词同时匹配 key、各语言名字、各源原始串与源 id。
   *
   * `scope` 按「这条实体有没有该语言的译名」过滤，供管理页按语言维护：
   * `withName` 只列已有的（= 该语言真正有数据的部分），`missingName` 只列缺的（补译名时用）。
   * ⚠️ 判定用**精确语言**（`names[lang]`），**不把同语族的 zh-Hans 当作 zh-Hant 已有** ——
   * 编辑列写的正是 `names[lang]`，两者口径必须一致，否则会出现「列表说有一列却是空的」。
   */
  query(
    lang: string,
    keyword = '',
    limit = 200,
    offset = 0,
    scope: TagLexiconQueryScope = 'all'
  ): TagLexiconQueryResult {
    const needle = normalizeTagString(keyword)
    const matched: EffectiveTag[] = []

    for (const tag of this.effective.values()) {
      if (scope === 'withName' && !tag.names[lang]) continue
      if (scope === 'missingName' && tag.names[lang]) continue
      if (needle && !this.matches(tag, needle)) continue
      matched.push(tag)
    }

    matched.sort((a, b) => {
      if (a.origin !== b.origin) return a.origin === 'user' ? -1 : 1
      return this.display(a.key, lang).localeCompare(this.display(b.key, lang), lang)
    })

    return {
      total: matched.length,
      entities: matched.slice(offset, offset + limit).map((tag) => this.toEntity(tag, lang))
    }
  }

  private matches(tag: EffectiveTag, needle: string): boolean {
    if (normalizeTagString(tag.key).includes(needle)) return true
    if (Object.values(tag.names).some((name) => normalizeTagString(name).includes(needle)))
      return true
    for (const list of [...Object.values(tag.src), ...Object.values(tag.ids)]) {
      if (list.some((item) => normalizeTagString(item).includes(needle))) return true
    }
    return false
  }

  /** 写入/移除某个语言的译名。移除后若实体已无任何译名，则整条删除（内置条目会退回内置值） */
  async setName(key: string, lang: string, value: string): Promise<void> {
    const target = this.followRedirect(key)
    if (!lang.trim()) return

    const record = (this.data.tags[target] ??= { names: {} })
    const trimmed = value.trim()
    if (trimmed) record.names[lang] = trimmed
    else delete record.names[lang]
    // 用户一旦动手写/清这个语言，就把抓取自动积累的同语言名字摘掉：
    // 写的时候它已被 `names` 覆盖、留着是死数据；清空时更必须摘掉，
    // 否则 `rebuild` 的优先级合并会让自动抓来的名字又冒出来，看着像「删不掉」。
    if (record.fetchedNames) delete record.fetchedNames[lang]

    // ⚠️ 用 isEmptyRecord 而不是 `names 为空` —— 否则清空唯一译名会把这条记录带着
    // src/ids 线索一起删掉（跨语言归并的成果就此丢失）
    if (isEmptyRecord(record)) delete this.data.tags[target]

    await this.persist()
    this.rebuild()
    this.notifyConflictChange()
  }

  async deleteTag(key: string): Promise<void> {
    const target = this.followRedirect(key)
    let changed = false
    if (this.data.tags[target]) {
      delete this.data.tags[target]
      changed = true
    }
    // ⚠️ 两个都要看：`redirects[target]` 是「目标自己也是被并掉的那条」，
    // 而 `redirects[key]` 是「传进来的这个 key 本身就是被并掉的旧 key」——
    // 后者如果不删，删完只剩一条指向已不存在实体的空 redirect 留在文件里。
    if (this.data.redirects[target]) {
      delete this.data.redirects[target]
      changed = true
    }
    if (this.data.redirects[key]) {
      delete this.data.redirects[key]
      changed = true
    }
    if (!changed) return
    await this.persist()
    this.rebuild()
    this.notifyConflictChange()
  }

  /**
   * 合并两条实体：把 from 的名字并入 into，并登记重定向。
   * 原始记录存进 redirects[from].backup，便于日后撤销。
   *
   * `namesOverride` 里的语言**直接用给定的写法**（不传则以目标为准）—— 一个语言只能有一个
   * 显示名，两边同语言都有写法时必然要丢一个，所以让用户在合并对话框里逐语言决定：
   * 保留目标 / 保留本条 / 自己输入。UI 负责把这三种选择算成「该语言最终用什么」。
   */
  async merge(
    fromKey: string,
    intoKey: string,
    namesOverride: Record<string, string> = {}
  ): Promise<void> {
    const from = this.followRedirect(fromKey)
    const into = this.followRedirect(intoKey)
    if (from === into) return

    const fromRecord = this.effective.get(from)
    const intoRecord = this.effective.get(into)
    if (!intoRecord) throw new Error(`Target tag not found: ${intoKey}`)

    // ⚠️ 这里用的是 effective 的**合并结果**（已含 fetchedNames），所以抓取自动积累的
    // 名字会在合并后落进新记录的 `names`、定性成「用户译名」。用户主动合并两条实体
    // 本来就该算「自己碰过」，所以可以接受；不额外保留 fetchedNames 反而更简单。
    const names = unionNames(fromRecord?.names, intoRecord.names)
    // 用户在预览里逐语言选过之后的结果：该语言最终用什么写法，直接覆盖掉
    // `unionNames`（extra 覆盖 base）给出的默认值。`unionNames` 返回的是新对象，改它
    // 不会污染 effective ✅ 空串（输入框没填）视为「没选」，沿用默认。
    for (const [lang, value] of Object.entries(namesOverride)) {
      if (typeof value === 'string' && value.trim()) names[lang] = value
    }
    const src = unionStringMap(fromRecord?.src, intoRecord.src)
    const ids = unionStringMap(fromRecord?.ids, intoRecord.ids)

    const next: TagLexiconTagRecord = { names }
    if (Object.keys(src).length > 0) next.src = src
    if (Object.keys(ids).length > 0) next.ids = ids

    delete this.data.tags[from]
    this.data.tags[into] = next
    this.data.redirects[from] = {
      to: into,
      at: new Date().toISOString(),
      ...(fromRecord
        ? {
            backup: {
              names: fromRecord.names,
              ...(Object.keys(fromRecord.src).length > 0 ? { src: fromRecord.src } : {}),
              ...(Object.keys(fromRecord.ids).length > 0 ? { ids: fromRecord.ids } : {})
            }
          }
        : {})
    }

    await this.persist()
    this.rebuild()
    this.notifyConflictChange()
    log.info(`[TagLexicon] Merged "${from}" into "${into}"`)
  }

  // -------------------------------------------------------------------------------------------
  // 冲突：入库不再自动按文本归并后，需要人来决定的地方（详见 TagLexiconConflict 的注释）
  // -------------------------------------------------------------------------------------------

  /**
   * 一条实体的全部显示名，**当前语言优先**，其余按 names 的顺序。
   *
   * 给 transformer 的标签规则用：规则是按「人看得懂的名字」写的，而库里存的是 key，
   * 所以要拿这条实体的各语言名字逐个去试（中文规则命中 `zh-Hans` 名、日文规则命中 `ja` 名）。
   * 只给 `names`（生效名，含抓取自动积累的），不含 `src` 里的历史写法 ——
   * 别名列表里随便一条命中就改写标签太容易误伤。
   */
  displayNames(key: string, lang: string): string[] {
    const target = this.followRedirect(key)
    const tag = this.effective.get(target)
    if (!tag) return []

    const ordered: string[] = []
    const push = (value: string | undefined): void => {
      if (value && !ordered.includes(value)) ordered.push(value)
    }
    push(tag.names[lang])
    for (const [code, value] of Object.entries(tag.names)) {
      if (baseLanguage(code) === baseLanguage(lang)) push(value)
    }
    for (const [code, value] of Object.entries(tag.names)) {
      if (code !== lang) push(value)
    }
    return ordered
  }

  /** 待处理的冲突数（角标用） */
  countPendingConflicts(): number {
    return (this.data.conflicts ?? []).filter((item) => item.status === 'pending').length
  }

  /**
   * 待处理冲突数变化时推给渲染层（侧栏角标、已打开的冲突面板跟着刷新）。
   * 只在实际变化时发，且吞掉异常 —— 词库在窗口建好之前也可能被加载/迁移。
   */
  private notifyConflictChange(): void {
    const count = this.countPendingConflicts()
    if (count === this.notifiedConflictCount) return
    this.notifiedConflictCount = count
    try {
      ipcManager.send('tag-lexicon:conflicts-changed', count)
    } catch (error) {
      log.warn('[TagLexicon] Failed to notify the conflict change:', error)
    }
  }

  /**
   * 按 key 取实体（冲突面板要同时展示冲突双方）。key 可以是老形式 —— 走 `followRedirect`，
   * 所以冲突记录里存的 key 即便后来被并走也取得到目标实体。
   */
  getEntity(key: string, lang: string): TagLexiconEntity | null {
    const target = this.followRedirect(key)
    const tag = this.effective.get(target)
    return tag ? this.toEntity(tag, lang) : null
  }

  /**
   * 是不是「用户自己写出来的」标签实体 —— 判定依据是 `src.user` 上有线索。
   *
   * 详情页手写标签走 `ensure-many(provider: 'user')`：词库**认不出**的原文会被铸造成一条
   * 新实体（`src.user = [原文]`），**认得出**的则直接命中已有实体。所以「`src.user` 有线索」
   * 恰好圈出「抓取源不会返回、只有用户自己有」的那些标签。
   *
   * ⚠️ 早先这是靠 key 前缀（`@user:xxx`）判断的，但 key 换成中性哈希（`@tag:<hash>`）之后
   * 前缀不复存在，那个判定**永远返回 false** → 更新元数据走 `replace` 时会把用户手写的标签
   * 一起抹掉。所以判定必须回到实体身上。
   *
   * ⚠️ 它不覆盖「用户手写了一个词库已认识的标签」（那种没有 `src.user`，与抓取来的写法
   * 无法区分）—— 那类只能靠 `append` / `merge` 策略避开。
   */
  isUserAuthored(key: string): boolean {
    const tag = this.effective.get(this.followRedirect(key))
    return !!tag && (tag.src?.[USER_TAG_NAMESPACE]?.length ?? 0) > 0
  }

  /**
   * 列出冲突，按「待处理在前、同语言聚在一起」排序；顺手清掉已失效的记录。
   *
   * 落盘交给调用方：正常情况下失效项是「上次处理后留下的」，直接写回一次即可；
   * 如果没有变化就不写，避免每次打开面板都改文件时间戳。
   */
  async listConflicts(): Promise<TagLexiconConflict[]> {
    const before = (this.data.conflicts ?? []).length
    this.pruneConflicts()
    if ((this.data.conflicts ?? []).length !== before) await this.persist()

    return [...(this.data.conflicts ?? [])].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
      if (a.lang !== b.lang) return a.lang.localeCompare(b.lang)
      if (a.key !== b.key) return a.key.localeCompare(b.key)
      return a.incoming.localeCompare(b.incoming)
    })
  }

  /**
   * 处理一条冲突。
   *
   * - `accept` + `duplicate`：把新铸的那条并进已有实体（`merge` 会写 redirect，老 key 照样能解析）
   * - `accept` + `name`：把抓到的写法写成该语言的译名
   * - `keep`：保留现状，标成 `ignored`，同一个写法以后不再问
   */
  async resolveConflict(id: string, action: 'accept' | 'keep'): Promise<void> {
    const conflict = (this.data.conflicts ?? []).find((item) => item.id === id)
    if (!conflict) return

    if (action === 'keep') {
      if (conflict.status === 'ignored') return
      conflict.status = 'ignored'
      await this.persist()
      this.notifyConflictChange()
      return
    }

    if (conflict.kind === 'duplicate' && conflict.other) {
      await this.merge(conflict.key, conflict.other)
      // merge 内部已经 persist + rebuild，这里只负责把冲突记录摘掉
      this.data.conflicts = (this.data.conflicts ?? []).filter((item) => item.id !== id)
      await this.persist()
      this.rebuild()
      this.notifyConflictChange()
      return
    }

    // `name`：采纳抓到的写法。写进 `names` 而不是 `fetchedNames` —— 这是用户明确的选择，
    // 要能压过内置译名（优先级：用户 names > 内置 names > fetchedNames）。
    const target = this.followRedirect(conflict.key)
    const record = (this.data.tags[target] ??= { names: {} })
    record.names[conflict.lang] = conflict.incoming
    if (record.fetchedNames) {
      // 同语言先前自动积累的写法会让位给这个明确选择，否则「清空译名」时它会再冒出来
      delete record.fetchedNames[conflict.lang]
      if (Object.keys(record.fetchedNames).length === 0) delete record.fetchedNames
    }
    this.data.conflicts = (this.data.conflicts ?? []).filter((item) => item.id !== id)
    await this.persist()
    this.rebuild()
    this.notifyConflictChange()
    log.info(
      `[TagLexicon] Conflict accepted: "${target}" ${conflict.lang} = "${conflict.incoming}"`
    )
  }

  /**
   * 摘掉某条实体上某个源的全部线索。返回是否真的改动过。
   *
   * 摘除的意义是「这条实体不该被这个源命中」：之后扫描该源时会走 id/文本的正常路径，
   * 需要的话会重新铸一条自己的实体（而不是并进这条）。
   * ⚠️ 内置表的线索摘不掉 —— 那些来自 `getBuiltinTags()`，不在用户文件里，
   * 摘了也会被下一次 `rebuild()` 加回来（内置表是权威数据，本来也不该改）。
   */
  private detachSource(key: string, provider: string): boolean {
    const record = this.data.tags[key]
    if (!record) return false
    let changed = false
    if (record.src?.[provider]) {
      delete record.src[provider]
      if (Object.keys(record.src).length === 0) delete record.src
      changed = true
    }
    if (record.ids?.[provider]) {
      delete record.ids[provider]
      if (Object.keys(record.ids).length === 0) delete record.ids
      changed = true
    }
    if (!changed) return false
    if (isEmptyRecord(record)) delete this.data.tags[key]
    return true
  }

  async removeSource(key: string, provider: string): Promise<TagLexiconRemoveSourceResult> {
    const target = this.followRedirect(key)
    const namespace = provider.trim()
    if (!target.trim() || !namespace) return emptyRemoveResult()

    const record = this.data.tags[target]
    const detached = {
      src: [...(record?.src?.[namespace] ?? [])],
      ids: [...(record?.ids?.[namespace] ?? [])]
    }
    // 内置表提供的线索摘不掉（不在用户文件里），如实报给调用方，别静默成功
    const blocked = this.builtinPartOf(target, namespace, detached)

    if (!this.detachSource(target, namespace)) {
      return { detached: { src: [], ids: [] }, blocked, sourceIsShell: false }
    }
    // ⚠️ 先 rebuild 再 persist：rebuild 里的 pruneConflicts 会丢掉「线索已挪走」的冲突，
    //    顺序反了这些记录就会留在磁盘上（下次启动又被加载回来）。
    this.rebuild()
    await this.persist()
    this.notifyConflictChange()
    log.info(`[TagLexicon] Detached source "${namespace}" from "${target}"`)
    return { detached, blocked, sourceIsShell: this.isShell(target) }
  }

  /**
   * 把「某个源在某条实体上的全部线索」改挂到另一条实体上。
   *
   * 单位是**源**而不是单条原始串：一条实体在一个源上只对应一个概念，而 `src` 与 `ids`
   * 是两个平行数组、下标并不一一对应（DLsite 的「角色扮演」与「ロールプレイング」共用
   * 一个 `type:RPG`），所以只能整块挪。
   *
   * 与 `merge` 的区别：merge 是把**整条实体**并掉（写 redirect，原 key 不再独立存在），
   * 改挂只动线索、两条实体都还在 —— 典型场景是「DLsite 的作品形式被并进了 vndb 的
   * 另一条实体」，需要把它挪到正确的实体上，而不是把 vndb 那条并掉。
   *
   * ⚠️ 只挪得动**用户词库文件里**的线索。内置表（`getBuiltinTags()`）提供的那些
   * 摘了也会在 rebuild 里加回来，所以走 `blocked` 原样返回而不是假装挪走。
   */
  async moveSource(
    fromKey: string,
    intoKey: string,
    provider: string
  ): Promise<TagLexiconMoveSourceResult> {
    const from = this.followRedirect(fromKey)
    const into = this.followRedirect(intoKey)
    const namespace = provider.trim()
    if (!namespace || from === into) return emptyMoveResult()
    if (!this.effective.has(into)) throw new Error(`Target tag not found: ${intoKey}`)

    const source = this.data.tags[from]
    const moved: TagLexiconMoveSourceResult['moved'] = {
      src: [...(source?.src?.[namespace] ?? [])],
      ids: [...(source?.ids?.[namespace] ?? [])]
    }
    const blocked = this.builtinPartOf(from, namespace, moved)

    // 没有任何可挪的线索（多半整个源都由内置表提供）—— 明确返回，别静默成功
    if (moved.src.length === 0 && moved.ids.length === 0) {
      log.info(
        `[TagLexicon] Nothing movable on "${from}" for source "${namespace}" ` +
          `(blocked: ${blocked.src.length} src / ${blocked.ids.length} ids)`
      )
      return { moved, blocked, sourceIsShell: false }
    }

    const target = (this.data.tags[into] ??= { names: {} })
    if (moved.src.length > 0) {
      const list = ((target.src ??= {})[namespace] ??= [])
      for (const raw of moved.src) if (!list.includes(raw)) list.push(raw)
    }
    if (moved.ids.length > 0) {
      const list = ((target.ids ??= {})[namespace] ??= [])
      for (const id of moved.ids) if (!list.includes(id)) list.push(id)
    }

    this.detachSource(from, namespace)
    // ⚠️ 顺序同 removeSource：rebuild（内含 pruneConflicts）必须在 persist 之前
    this.rebuild()
    await this.persist()
    this.notifyConflictChange()
    log.info(`[TagLexicon] Moved source "${namespace}" from "${from}" to "${into}"`)
    return { moved, blocked, sourceIsShell: this.isShell(from) }
  }

  /**
   * 某个源在某条实体上的线索里，**属于内置表**（用户改不动）的那部分。
   *
   * 算法是「有效实体上的线索 − 用户文件里的线索」：`effective` 是内置与用户的合并结果，
   * 减掉用户那份剩下的就只可能来自内置表。比直接查 `getBuiltinTags()` 更准 ——
   * 后者是「整条实体」粒度，而这里要的是「某个源」粒度。
   */
  private builtinPartOf(
    key: string,
    provider: string,
    userOwned: { src: string[]; ids: string[] }
  ): { src: string[]; ids: string[] } {
    const tag = this.effective.get(this.followRedirect(key))
    return {
      src: (tag?.src[provider] ?? []).filter((raw) => !userOwned.src.includes(raw)),
      ids: (tag?.ids[provider] ?? []).filter((id) => !userOwned.ids.includes(id))
    }
  }

  getLanguages(): string[] {
    return Object.keys(this.countByLanguage()).sort()
  }

  /** 各语言已有译名的实体数。管理页用它显示「ja 已有 53 / 3057」这类进度 */
  countByLanguage(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const tag of this.effective.values()) {
      for (const [lang, value] of Object.entries(tag.names)) {
        if (value) counts[lang] = (counts[lang] ?? 0) + 1
      }
    }
    return counts
  }

  getState(currentLang: string): TagLexiconState {
    let userCount = 0
    for (const tag of this.effective.values()) if (tag.origin === 'user') userCount++
    const languageCounts = this.countByLanguage()
    return {
      path: this.filePath,
      fallback: [...this.data.fallback],
      languages: Object.keys(languageCounts).sort(),
      languageCounts,
      tagCount: this.effective.size,
      userCount,
      builtinCount: this.effective.size - userCount,
      mergedCount: Object.keys(this.data.redirects).length,
      conflictCount: this.countPendingConflicts(),
      currentLang
    }
  }

  /** 导出词库（不传 lang 则导出全部） */
  exportUser(lang?: string): string {
    return this.serialize(lang)
  }

  /** 导入词库：merge 只覆盖同名条目，replace 清空后整体替换 */
  async importUser(
    content: string,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<TagLexiconImportSummary> {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('Invalid JSON')
    }

    const incoming = sanitizeFile(parsed)
    if (
      Object.keys(incoming.tags).length === 0 &&
      Object.keys(incoming.redirects).length === 0 &&
      (incoming.conflicts ?? []).length === 0
    ) {
      throw new Error('No valid entries found in the lexicon file')
    }

    if (mode === 'replace') this.data = createEmptyFile()

    let added = 0
    let updated = 0
    const touched = new Set<string>()

    for (const [key, record] of Object.entries(incoming.tags)) {
      const target = (this.data.tags[key] ??= { names: {} })
      for (const [lang, value] of Object.entries(record.names)) {
        if (target.names[lang] === undefined) added++
        else if (target.names[lang] !== value) updated++
        target.names[lang] = value
        touched.add(lang)
      }
      // ⚠️ 线索的合并**不能**挂在「names 有内容」的条件上：导入「只有 src/ids、
      // 没有译名」的记录（手工跨源映射就是这个形态）时循环一次都不进，
      // 线索会被整个丢掉。
      const fetchedNames = unionNames(target.fetchedNames, record.fetchedNames)
      const src = unionStringMap(target.src, record.src)
      const ids = unionStringMap(target.ids, record.ids)
      if (Object.keys(fetchedNames).length > 0) target.fetchedNames = fetchedNames
      if (Object.keys(src).length > 0) target.src = src
      if (Object.keys(ids).length > 0) target.ids = ids
      // 合完仍是空壳就别在文件里留这条
      if (isEmptyRecord(target)) delete this.data.tags[key]
    }

    for (const [from, redirect] of Object.entries(incoming.redirects)) {
      this.data.redirects[from] = redirect
    }

    // 冲突一起并进来（备份恢复时不能把「已忽略」的决定丢掉）；本地已有的状态优先。
    for (const conflict of incoming.conflicts ?? []) {
      const existing = (this.data.conflicts ?? []).find((item) => item.id === conflict.id)
      if (existing) {
        existing.ids = conflict.ids ?? existing.ids
        continue
      }
      ;(this.data.conflicts ??= []).push(conflict)
    }

    await this.persist()
    this.rebuild()
    this.notifyConflictChange()
    return { added, updated, languages: Array.from(touched).sort() }
  }
}
