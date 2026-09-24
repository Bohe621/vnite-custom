import type { TagLexiconEntity } from '@appTypes/models'

/**
 * 「这两条实体是不是同一个概念」的**可比证据**。
 *
 * 冲突面板只凭「同一个中文名下撞了」是不够的 —— DLsite 的「角色扮演」（RPG 游戏类型）与
 * vndb 的「角色扮演」（cosplay）就是这样撞上的，靠中文名永远分不清。而两边的**英文名**
 * 是可靠的桥：DLsite 同一个 genre id 在英文站有固定英文名（`genre:019` → `Horror`、
 * `type:ACN` → `Action`），vndb 侧的英文名就是它自己的 tag 名。
 *
 * 英文名怎么来的：DLsite 的标签文本随 `?locale=` 变，词库里 dlsite 实体原本只有抓取那一刻
 * 界面语言的名字；补英文名走的是「同一个源内 id 换语言再抓一次」——
 * `.workbuddy/scripts/enrich-dlsite-en-names.mjs` 抓 `?locale=en-US` 页面后调
 * `tag-lexicon:ensure { provider:'dlsite', id, lang:'en' }`，英文名落在 `names.en`
 * （实际存进记录的 `fetchedNames.en`，与自动积累的译名同一套机制）。
 */

/** 参与比对的一条写法：某个语言下的译名，或某个源返回过的原串（别名） */
export interface NameEvidence {
  /** 展示用来源：`en` / `zh-Hans` / `vndb alias` */
  label: string
  value: string
}

export type SynonymVerdict = 'same' | 'alias' | 'similar' | 'different' | 'unknown'

export interface SynonymComparison {
  verdict: SynonymVerdict
  englishA: string | null
  englishB: string | null
  /** 命中的证据对（仅 `alias` 档会有非空值） */
  matches: { a: NameEvidence; b: NameEvidence }[]
}

/**
 * 规范化：小写并去掉空白与常见分隔符。
 * `Foot Job` == `Footjob`、`Squirting / Gushing` → `squirtinggushing`。
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s\-_'’`·・,，。.()（）[\]{}]/g, '')
}

/** 一条实体上所有可用于比对的写法：先各语言译名，再各源别名 */
export function nameEvidence(entity: TagLexiconEntity | undefined): NameEvidence[] {
  if (!entity) return []
  const out: NameEvidence[] = []
  for (const [lang, value] of Object.entries(entity.names ?? {})) {
    if (value?.trim()) out.push({ label: lang, value: value.trim() })
  }
  for (const [provider, list] of Object.entries(entity.src ?? {})) {
    for (const value of list ?? []) {
      if (value?.trim()) out.push({ label: `${provider} alias`, value: value.trim() })
    }
  }
  return out
}

/**
 * 把一条写法切成可比对的词。
 *
 * 必须拆：DLsite 的英文名常是复合写法（`Squirting / Gushing`），而 vndb 侧把它们作为
 * **两个别名**分开登记（`Gushing`、`Squirting`），不拆就永远对不上。
 * 只留 ≥3 个字符的词，免得 `a` / `of` 这种噪声把什么都判成命中。
 */
function tokensOf(value: string): string[] {
  return value
    .split(/[/·,，、|]/)
    .map(normalize)
    .filter((token) => token.length >= 3)
}

/** 只有译名（不含别名），用于在行里展示「这条实体在各语言下叫什么」 */
export function nameSummary(entity: TagLexiconEntity | undefined): string {
  if (!entity) return ''
  return Object.entries(entity.names ?? {})
    .filter(([, value]) => !!value?.trim())
    .map(([lang, value]) => `${lang} ${value.trim()}`)
    .join(' · ')
}

/**
 * 比较两条实体，给出「疑似同义」的档位。
 *
 * 逐语言比对，但**排除冲突语言**（两侧在那门语言下本来就同名，那是冲突的成因，拿它比会人人过关）：
 *
 * - `same`：某门语言下两侧的写法规范化后完全相同（`en Action` ↔ `en Action`；
 *   或 `ja 悪堕ち` ↔ `ja 悪堕ち`）
 * - `alias`：一侧的某个写法**每个词**都能在另一侧的别名/原始串里找到
 *   （`Living Together` 命中 vndb `Under the Same Roof` 的别名；
 *   `Squirting / Gushing` 命中 `Female Ejaculation` 的别名 `Gushing` / `Squirting`）
 * - `similar`：英文名一方是另一方的前后缀扩展（`Shota` ⊂ `Shotacon`）
 * - `different`：两侧都有可比写法但都对不上（`Corrupted Morals` vs `Falling to Evil (sexual)`）
 * - `unknown`：除冲突语言外没有任何两侧都有的语言，没法比
 *
 * 为什么需要日文：DLsite 的标签是日文原生的，很多概念的英文名与 vndb 的英文名并不字面一致
 * （`恶堕` 的 DLsite 英文名是 `Corrupted Morals`、vndb 是 `Falling to Evil (sexual)`），
 * 但**日文名都是「悪堕ち」** —— 只看英文会判成「不同概念」，只看日文一眼就成立。
 * 所以 dlsite 实体的英文/日文名都要补（`.workbuddy/scripts/enrich-dlsite-en-names.mjs`）。
 */
export function compareEntities(
  a: TagLexiconEntity | undefined,
  b: TagLexiconEntity | undefined,
  excludeLang?: string
): SynonymComparison {
  const englishA = a?.names?.en?.trim() ?? null
  const englishB = b?.names?.en?.trim() ?? null
  const base: SynonymComparison = { verdict: 'unknown', englishA, englishB, matches: [] }

  const nameOf = (entity: TagLexiconEntity | undefined, lang: string): string | null =>
    entity?.names?.[lang]?.trim() || null

  // ① 逐语言精确一致
  const languages = [
    ...new Set([...Object.keys(a?.names ?? {}), ...Object.keys(b?.names ?? {})])
  ].filter((lang) => lang !== excludeLang)
  for (const lang of languages) {
    const va = nameOf(a, lang)
    const vb = nameOf(b, lang)
    if (va && vb && normalize(va) === normalize(vb)) {
      return {
        ...base,
        verdict: 'same',
        matches: [{ a: { label: lang, value: va }, b: { label: lang, value: vb } }]
      }
    }
  }

  /** 别名证据 = 各源返回过的原始串（不含任何语言的译名） */
  const aliasOf = (entity: TagLexiconEntity | undefined): NameEvidence[] =>
    nameEvidence(entity).filter((item) => item.label.endsWith('alias'))

  /**
   * 一侧某个写法的**每个词**都能在另一侧的别名里找到 → 命中别名。
   * 按词比对，所以 `Squirting / Gushing` 能命中另一侧的 `Gushing` + `Squirting` 两条别名。
   */
  const aliasMatches = (
    tokens: string[],
    aliasEvidence: NameEvidence[],
    own: NameEvidence
  ): { a: NameEvidence; b: NameEvidence }[] => {
    const out: { a: NameEvidence; b: NameEvidence }[] = []
    for (const token of tokens) {
      const hit = aliasEvidence.find((item) => tokensOf(item.value).includes(token))
      if (!hit) return []
      if (!out.some((pair) => pair.b.value === hit.value)) out.push({ a: own, b: hit })
    }
    return out
  }

  const aliasA = aliasOf(a)
  const aliasB = aliasOf(b)
  const matches: { a: NameEvidence; b: NameEvidence }[] = []
  // ② 除冲突语言外，每一门语言的两侧写法都拿去撞对方的别名
  for (const lang of languages) {
    const va = nameOf(a, lang)
    const vb = nameOf(b, lang)
    if (va) matches.push(...aliasMatches(tokensOf(va), aliasB, { label: lang, value: va }))
    if (vb) matches.push(...aliasMatches(tokensOf(vb), aliasA, { label: lang, value: vb }))
  }
  if (matches.length > 0) return { ...base, verdict: 'alias', matches }

  // ③ 英文名的高度相似（前缀/包含）
  if (englishA && englishB) {
    const na = normalize(englishA)
    const nb = normalize(englishB)
    const shorter = na.length <= nb.length ? na : nb
    const longer = na.length <= nb.length ? nb : na
    if (shorter.length >= 4 && longer.includes(shorter)) return { ...base, verdict: 'similar' }
  }

  // 两侧都没有「除冲突语言外都有的语言」时，属于没法比
  const comparable = languages.some((lang) => nameOf(a, lang) && nameOf(b, lang))
  if (!comparable) return base

  return { ...base, verdict: 'different' }
}
