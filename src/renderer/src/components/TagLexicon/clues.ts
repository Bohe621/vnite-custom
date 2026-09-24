import type { TagLexiconEntity } from '@appTypes/models'

/**
 * 把一条实体的来源线索压成一行摘要：`dlsite: 角色扮演, ロールプレイング · vndb: g753`。
 *
 * 单独一个模块而不是放在组件文件里：组件文件只能导出组件
 * （`react-refresh/only-export-components`），而冲突面板也要用这个函数。
 */
export function clueSummary(entity: TagLexiconEntity | undefined): string {
  if (!entity) return ''
  const parts: string[] = []
  for (const [provider, list] of Object.entries(entity.src)) {
    if (list.length > 0) parts.push(`${provider}: ${list.join(', ')}`)
  }
  for (const [provider, list] of Object.entries(entity.ids)) {
    if (list.length > 0) parts.push(`${provider}: ${list.join(', ')}`)
  }
  return parts.join(' · ')
}
