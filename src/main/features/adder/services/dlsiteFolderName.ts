/**
 * Extract the localized (Chinese) title and the version number out of a DLsite-style folder name.
 *
 * Folder names produced by DLsite downloaders look like this:
 *
 *   [azucat][RJ01323899] 妻子是自愿NTR 纯爱？复仇？ 奥様はNTR志望 純愛？復讐？ver1.001
 *   [Big S Studio][RJ01117570] 鉴黄师（the censor）v4.1.1
 *   [NTR教団][RJ417027] スパイ・ミッション ～彼女は貴族(オッサン)のメイド～ v1.03
 *   [まくらカバーソフト][RJ01431277] ダンジョンアンドブライド  v1.44
 *   [オニチク屋!][RJ01238308] 爱与和平的魔法少女 Roseleaf～绝对不能败给受孕监禁强奸!～
 *
 * i.e. `[circle][DLsite id] <Chinese title> <Japanese title> <version>`, where the Chinese and the
 * Japanese parts are separated by a space and any of the three may be missing.
 *
 * The scraper only ever gives us the Japanese title (DLsite sets `name` and `originalName` to the
 * same string), so the Chinese title has to come from the folder name — that is what this parser
 * is for. It stays a pure function so it can be exercised without booting Electron.
 *
 * Limitation: kana is the only reliable Chinese/Japanese separator available, so a Japanese title
 * written purely in ideographs cannot be told apart from the Chinese one and gets merged into it.
 * In practice the Japanese part is either kana-bearing (and therefore dropped) or absent, and the
 * split also stops at the first kana segment, so a trailing Japanese fragment normally stays out.
 */

/** DLsite product ids: `RJ123456`, `RE123456`, `VJ123456`. */
const DLSITE_ID_REGEX = /(?:rj|re|vj)\d{4,}/i

/**
 * A trailing version marker: `v1.03`, `ver1.001`, `Ver. 1.0`, optionally wrapped in brackets.
 * The leading `v` is required — a bare number would be indistinguishable from part of a title.
 */
const TRAILING_VERSION_REGEX = /[vV](?:er(?:sion)?)?\.?\s*(\d+(?:\.\d+)*)\s*[\])）】]?$/

/** Hiragana / katakana / half-width katakana — the strongest "this text is Japanese" signal. */
const KANA_REGEX = /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f]/

/** CJK ideographs (including the extension A and compatibility blocks). */
const CJK_REGEX = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** Characters that may dangle after the version marker or the closing `]` of `[RJ...]`. */
const DANGLING_SEPARATOR_REGEX = /[\s[\](（【]+$/

export interface DlsiteFolderNameMetadata {
  /** Chinese title taken from the folder name, or `null` when the folder has none. */
  localizedName: string | null
  /** Version number without the `v`/`ver` prefix, or `null` when the folder has none. */
  version: string | null
}

const EMPTY_RESULT: DlsiteFolderNameMetadata = { localizedName: null, version: null }

/**
 * @param folderName A single folder name (not a full path).
 */
export function parseDlsiteFolderName(folderName: string): DlsiteFolderNameMetadata {
  if (!folderName) return EMPTY_RESULT

  const idMatch = folderName.match(DLSITE_ID_REGEX)
  if (!idMatch || idMatch.index === undefined) return EMPTY_RESULT

  // Everything after the id is the title; drop the `]` that closes `[RJ...]` plus any spacing.
  let rest = folderName.slice(idMatch.index + idMatch[0].length).replace(/^[\s\][)）】]+/, '')

  // The version marker sits at the very end, so take it off before looking at the title.
  let version: string | null = null
  const versionMatch = rest.match(TRAILING_VERSION_REGEX)
  if (versionMatch && versionMatch.index !== undefined) {
    version = versionMatch[1]
    rest = rest.slice(0, versionMatch.index).replace(DANGLING_SEPARATOR_REGEX, '')
  }

  return { localizedName: extractLocalizedName(rest), version }
}

/**
 * Keep only the leading Chinese part of a title that has already had its version marker removed.
 *
 * Segments are split on whitespace. As soon as a segment contains kana, everything from there on
 * is the Japanese title and is dropped. In the first example above the break lands on
 * `奥様はNTR志望` (it contains `は`), so the following `純愛？復讐？` never has to be judged on its
 * own — which is fortunate, because it is written in pure ideographs and would otherwise look
 * exactly like a Chinese title.
 */
function extractLocalizedName(title: string): string | null {
  const kept: string[] = []
  for (const segment of title.split(/\s+/).filter((s) => s.length > 0)) {
    if (KANA_REGEX.test(segment)) break
    kept.push(segment)
  }

  const localizedName = kept.join(' ').trim()
  if (!localizedName || !CJK_REGEX.test(localizedName)) return null

  return localizedName
}
