import type { TagLexiconEntity } from '@appTypes/models'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcManager } from '~/app/ipc'
import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { cn } from '~/utils'
import { clueSummary } from './clues'

/**
 * 挑一条标签实体（合并/改挂的目标）。
 *
 * 只列已有该语言译名之外的全部实体 —— 目标可能是任何一条，所以走 `scope: 'all'`。
 * 输入停下来 200ms 才查，避免每敲一个字就扫一遍 3000 条实体。
 */
export function EntityPicker({
  value,
  onChange,
  exclude = [],
  lang,
  placeholder
}: {
  value: string | null
  onChange: (key: string) => void
  /** 不列出来的 key（通常是被操作的那条实体自己） */
  exclude?: string[]
  lang?: string
  placeholder?: string
}): React.JSX.Element {
  const { t } = useTranslation('tagLexicon')
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<TagLexiconEntity[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const requestId = useRef(0)

  const excluded = useMemo(() => new Set(exclude), [exclude])

  useEffect(() => {
    const id = ++requestId.current
    setIsLoading(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await ipcManager.invoke('tag-lexicon:query', {
            lang,
            keyword,
            scope: 'all',
            limit: 50,
            offset: 0
          })
          // 慢请求回来时用户可能已经改过关键词，丢掉过期结果
          if (id !== requestId.current) return
          setItems((result.entities ?? []).filter((entity) => !excluded.has(entity.key)))
        } catch (error) {
          console.error('[TagLexicon] Failed to search entities:', error)
        } finally {
          if (id === requestId.current) setIsLoading(false)
        }
      })()
    }, 200)

    return () => clearTimeout(timer)
  }, [keyword, lang, excluded])

  const selected = items.find((entity) => entity.key === value) ?? null

  /**
   * 当前选中的实体**独立查一次**，不依赖上面的搜索结果。
   *
   * ⚠️ 不能只用 `items.find(...)`：`items` 是「输入关键词的查询结果」（无关键词时只取前
   * `limit` 条），预选的目标（冲突面板从 duplicate 冲突进来时预设的对面那条）很可能不在
   * 这一页里 → 底部会显示「尚未选择目标实体」，用户以为没选上，其实 `value` 是有值的、
   * 点确定就会用它。2026-09-24 踩到。
   */
  const [selectedEntity, setSelectedEntity] = useState<TagLexiconEntity | null>(null)
  useEffect(() => {
    if (!value) {
      setSelectedEntity(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [loaded] = await ipcManager.invoke('tag-lexicon:get-entities', { keys: [value] })
        if (!cancelled) setSelectedEntity(loaded ?? null)
      } catch (error) {
        console.error('[TagLexicon] Failed to load the selected entity:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [value])

  /**
   * 底部「已选」的显示：名字 + 线索摘要。
   *
   * ⚠️ 光给名字不够用 —— 冲突面板里两条实体的**显示名本来就是相同的**（冲突就是这么
   * 产生的：「自慰」vs「自慰」），只写「已选：自慰」等于没说。线索摘要能区分是哪一条
   * （`dlsite: 自慰, Masturbation…` vs `vndb: Masturbation`）。
   */
  const selectedForLabel = selected ?? selectedEntity
  const selectedLabel = selectedForLabel?.display ?? value
  const selectedClue = selectedForLabel ? clueSummary(selectedForLabel) : ''

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col gap-2')}>
      <Input
        value={keyword}
        placeholder={placeholder ?? t('picker.searchPlaceholder')}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <ScrollArea className={cn('h-[240px] rounded-md border border-border')}>
        <div className={cn('flex min-w-0 flex-col p-1')}>
          {items.length === 0 && (
            <div className={cn('py-6 text-center text-xs text-muted-foreground')}>
              {isLoading ? t('picker.loading') : t('picker.empty')}
            </div>
          )}
          {items.map((entity) => {
            const isActive = entity.key === value
            return (
              <button
                key={entity.key}
                type="button"
                onClick={() => onChange(entity.key)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left',
                  'hover:bg-accent',
                  isActive && 'bg-accent',
                  // ⚠️ `contain: inline-size` 是必需的：Radix ScrollArea 的内层是
                  // `display: table`（shrink-to-fit），行的固有宽度会直接把它撑到 max-content，
                  // 长名实体（vndb 里最长的有 80+ 字符）会把整个对话框顶宽、内容溢出到框外。
                  // 这一格的宽度本来就由容器决定、与内容无关，所以告诉引擎别拿内容算固有宽度。
                  '[contain:inline-size]'
                )}
              >
                <div className={cn('flex w-full min-w-0 items-center gap-2')}>
                  {/* 换行而不是截断：长名（`Group Sex Involving a Mix of …`）截断后没法读 */}
                  <span className={cn('min-w-0 break-words text-sm')}>{entity.display}</span>
                  {entity.origin === 'builtin' && (
                    <Badge variant="outline" className={cn('shrink-0 text-[10px]')}>
                      {t('list.sourceBuiltin')}
                    </Badge>
                  )}
                </div>
                <span className={cn('w-full break-words text-[11px] text-muted-foreground')}>
                  {clueSummary(entity) || entity.key}
                </span>
              </button>
            )
          })}
        </div>
      </ScrollArea>
      <div className={cn('min-h-4 break-words text-xs text-muted-foreground')}>
        {selectedLabel ? (
          <>
            {t('picker.selected', { name: selectedLabel })}
            {selectedClue && (
              <span className={cn('text-muted-foreground/70')}> · {selectedClue}</span>
            )}
          </>
        ) : (
          t('picker.none')
        )}
      </div>
    </div>
  )
}
