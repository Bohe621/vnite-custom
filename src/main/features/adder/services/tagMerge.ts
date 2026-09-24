import type { GameMetadataUpdateOptions } from '@appTypes/utils'
import { TagLexiconManager } from '~/features/tagLexicon/services'

export type TagMergeStrategy = NonNullable<GameMetadataUpdateOptions['mergeStrategy']>

/**
 * `replace` 策略下必须保住的 key：**用户自己写出来的标签**（词库里 `src.user` 有线索的那些）。
 * 抓取源永远不会返回它们，被清掉就再也找不回来。判定放在词库那边，见 `isUserAuthored`。
 */
export function isUserAuthoredKey(key: string): boolean {
  return TagLexiconManager.getInstance().isUserAuthored(key)
}

/**
 * 合并两组标签 key —— 抓取链路上所有写 `metadata.tags` 的地方都走这里。
 *
 * 库里存的**永远是实体 key**（`@tag:<hash>`），不是显示名。显示用 `displayMap` 按当前语言
 * 解析，筛选按 key 精确匹配，所以这里的合并只在 key 层面做。
 *
 * 三条规则：
 * - `replace`：以新抓的为准，**但保留用户自己写出来的标签**。判定走 `isProtected`
 *   （实现是词库的 `isUserAuthored`，看 `src.user` 线索）。那些标签任何抓取源都不会返回，
 *   一旦被清掉就再也找不回来。
 * - `append` / `merge`：并集去重，`existing` 在前（顺序即优先级，头部是用户已有的）。
 *   ⚠️ 去重之后这两个策略**语义已经相同**，保留两个取值只是为了兼容既有 UI 与配置。
 *   原本 `append` 是「不去重的字面追加」，但 tags 是集合：重复 key 只会让标签墙显示两遍、
 *   筛选出现重复项，没有任何意义。
 *
 * ⚠️ `isProtected` 是**必填**的：早先这里靠 key 前缀（`@user:xxx`）判断，key 换成中性哈希后
 * 那个前缀没了、判定静默失效，`replace` 会把用户标签一起删掉。必填能让「漏传」在编译期暴露。
 *
 * 入参的 `undefined` / 空数组一律按空处理；返回恒为去重后的 key 数组。
 */
export function mergeTagKeys(
  existing: readonly string[] | undefined,
  incoming: readonly string[] | undefined,
  strategy: TagMergeStrategy,
  isProtected: (key: string) => boolean
): string[] {
  const previous = existing ?? []
  const next = incoming ?? []
  const kept = strategy === 'replace' ? previous.filter((key) => isProtected(key)) : previous
  return Array.from(new Set([...kept, ...next].filter((key) => !!key)))
}
