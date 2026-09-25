import type { TagLexiconEntity } from '@appTypes/models'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsUpDown, Plus, X } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Badge } from '~/components/ui/badge'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { useGameState, useTagDisplay } from '~/hooks'
import { cn } from '~/utils'
import { ipcManager } from '~/app/ipc'

/**
 * 游戏详情「标签」编辑弹窗。
 *
 * 从「逗号分隔文本框」重做成 chip 式：库里的每个标签是一枚可删的 chip（右侧 × 移除），
 * 顶部一个「添加标签」入口 —— 打字会实时搜标签词库（`tag-lexicon:query`），点结果就从
 * 词库选一个；或者直接回车 / 点「创建新标签」把输入当新标签铸进词库（`ensure-many`）。
 *
 * 落库语义不变：draft 里存的是实体 key，确定时整体再过一遍 `ensure-many`（认得出的复用、
 * 认不出的铸 user 标签）后写回 `metadata.tags`，写库的永远是 key。
 */
export function TagsDialog({
  gameId,
  isOpen,
  setIsOpen
}: {
  gameId: string
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation('game')
  // saveMode=true：第 4 个返回值是「改 store + 落库」的一步式 API，确定时才调用
  const [tags, , , setTagsAndSave] = useGameState(gameId, 'metadata.tags', true)

  /** 编辑中的暂存：标签实体 key 列表。弹窗打开时从库里现有值快照，确定才写回。 */
  const [draft, setDraft] = useState<string[]>([])
  /**
   * 本地已知显示名缓存：新加的 chip（词库结果 / 自定义）在 `useTagDisplay` 的 IPC 回来前
   * 就能立刻显示正确文字，避免闪一下 raw key（如 `@user:XXX`）。
   */
  const [localLabels, setLocalLabels] = useState<Record<string, string>>({})

  /** 词库搜索选择器 */
  const [pickerOpen, setPickerOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [results, setResults] = useState<TagLexiconEntity[]>([])
  const [searching, setSearching] = useState(false)
  const requestId = useRef(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  /** 库现有 key -> 当前语言译名（用于打开时已有 chip 的显示） */
  const tagDisplay = useTagDisplay(draft)

  /** 已加过的 key，用来把搜索结果里「已经在草稿里」的过滤掉 */
  const excludesSig = useMemo(() => Array.from(new Set(draft)).sort().join('\u0000'), [draft])
  const excludes = useMemo(() => new Set(draft), [draft])

  // 弹窗打开时从库里现有值做一次快照；编辑期间不跟 live 数据联动，确定前改动都留在 draft
  useEffect(() => {
    if (!isOpen) return
    setDraft(tags ? [...tags] : [])
    setLocalLabels({})
    setSearchText('')
    setResults([])
    setPickerOpen(false)
    // 仅依赖 isOpen：一旦打开就锁定初值，避免编辑过程中 store 更新把 draft 冲掉
  }, [isOpen])

  // 词库搜索：输入停顿 200ms 才查，避免每敲一字扫一遍；只列还没加进草稿的实体
  useEffect(() => {
    if (!pickerOpen) return
    const keyword = searchText.trim()
    if (!keyword) {
      setResults([])
      return
    }
    const id = ++requestId.current
    setSearching(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const r = await ipcManager.invoke('tag-lexicon:query', {
            keyword,
            scope: 'all',
            limit: 50
          })
          if (id !== requestId.current) return
          setResults((r.entities ?? []).filter((entity) => !excludes.has(entity.key)))
        } catch (error) {
          console.error('[TagsDialog] Failed to search tag library:', error)
          if (id === requestId.current) setResults([])
        } finally {
          if (id === requestId.current) setSearching(false)
        }
      })()
    }, 200)
    return () => clearTimeout(timer)
  }, [searchText, pickerOpen, excludesSig])

  const refocusSearch = (): void => {
    searchInputRef.current?.focus()
  }

  /** 从词库结果挑一个标签实体加进来 */
  const addFromLexicon = (entity: TagLexiconEntity): void => {
    if (draft.includes(entity.key)) {
      setSearchText('')
      refocusSearch()
      return
    }
    setDraft((prev) => [...prev, entity.key])
    setLocalLabels((prev) => ({ ...prev, [entity.key]: entity.display }))
    setSearchText('')
    setResults([])
    refocusSearch()
  }

  /** 把输入的文字作为新标签铸进词库：认得出的复用已有实体，认不出的铸 user 标签 */
  const createFromText = async (): Promise<void> => {
    const text = searchText.trim()
    // 用户这里是填"名字/译名"；以 @ 开头的是内部 key，不当作文本铸造（避免铸出脏标签）
    if (!text || text.startsWith('@')) {
      refocusSearch()
      return
    }
    try {
      const keys = await ipcManager.invoke('tag-lexicon:ensure-many', {
        values: [text],
        provider: 'user'
      })
      const key = keys?.[0]
      if (key) {
        setDraft((prev) => (prev.includes(key) ? prev : [...prev, key]))
        setLocalLabels((prev) => ({ ...prev, [key]: text }))
      }
    } catch (error) {
      console.error('[TagsDialog] Failed to create tag:', error)
    } finally {
      setSearchText('')
      setResults([])
      refocusSearch()
    }
  }

  const removeKey = (key: string): void => {
    setDraft((prev) => prev.filter((k) => k !== key))
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void createFromText()
    }
  }

  /**
   * 确定：draft 里绝大多数已是实体 key（词库选择 / 自定义铸造的），**不能**整体再跑
   * ensure-many —— 那会把"已有 key"当成"原文"重铸成新实体（会污染词库，2026-09-25 实测）。
   * 只把打开时带进来的旧原文（非 @ 值）归一成 key；已是 key 的一个都不动。
   */
  const handleConfirm = async (): Promise<void> => {
    const keys = [...draft]
    const legacyIdx = keys
      .map((value, index) => (value && value.startsWith('@') ? -1 : index))
      .filter((index) => index !== -1)
    if (legacyIdx.length > 0) {
      try {
        const resolved = await ipcManager.invoke('tag-lexicon:ensure-many', {
          values: legacyIdx.map((index) => keys[index]),
          provider: 'user'
        })
        legacyIdx.forEach((index, offset) => {
          if (resolved[offset]) keys[index] = resolved[offset]
        })
      } catch (error) {
        console.error('[TagsDialog] Failed to normalize legacy tags, saving raw values:', error)
      }
    }
    await setTagsAndSave(keys)
    setIsOpen(false)
  }

  const close = (): void => {
    // 取消 / 点背景 / 右上角 ×：只关闭，不回写 draft
    setIsOpen(false)
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className={cn('w-[460px] max-w-none flex flex-col gap-4')}>
        <DialogHeader>
          <DialogTitle>{t('detail.overview.tags.dialog.title')}</DialogTitle>
          <DialogDescription>{t('detail.overview.tags.dialog.description')}</DialogDescription>
        </DialogHeader>

        {/* 添加标签：打字搜词库，点结果从词库选；回车 / 「创建」则自己铸一个 */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen} modal={false}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={pickerOpen}
              className="justify-between non-draggable"
              onClick={() => refocusSearch()}
            >
              <span className="inline-flex min-w-0 items-center gap-2 text-muted-foreground">
                <Plus className="h-4 w-4 shrink-0" />
                <span className="truncate">{t('detail.overview.tags.dialog.addTag')}</span>
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[340px] p-2 max-w-none" align="start">
            <div className="flex flex-col gap-2">
              <Input
                ref={searchInputRef}
                value={searchText}
                autoFocus
                placeholder={t('detail.overview.tags.dialog.searchPlaceholder')}
                className="non-draggable bg-input/20"
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              <ScrollArea className="h-[220px] rounded-md border border-border">
                <div className="flex min-w-0 flex-col p-1">
                  {!searchText.trim() ? (
                    <div className={cn('px-2 py-6 text-center text-xs text-muted-foreground')}>
                      {t('detail.overview.tags.dialog.searchHint')}
                    </div>
                  ) : searching ? (
                    <div className={cn('px-2 py-6 text-center text-xs text-muted-foreground')}>
                      {t('detail.overview.tags.dialog.loading')}
                    </div>
                  ) : (
                    <>
                      {results.map((entity) => (
                        <button
                          key={entity.key}
                          type="button"
                          onClick={() => addFromLexicon(entity)}
                          className={cn(
                            'flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left',
                            'hover:bg-accent',
                            // 长名实体会把弹窗顶宽：这里宽度由容器定、与内容无关
                            '[contain:inline-size]'
                          )}
                        >
                          <span className="min-w-0 break-words text-sm">{entity.display}</span>
                        </button>
                      ))}
                      {results.length === 0 && (
                        <div className={cn('px-2 py-3 text-center text-xs text-muted-foreground')}>
                          {t('detail.overview.tags.dialog.noResults')}
                        </div>
                      )}
                      <div className={cn('my-1 border-t border-border')} />
                      <button
                        type="button"
                        onClick={() => void createFromText()}
                        className={cn(
                          'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left',
                          'text-primary hover:bg-accent [contain:inline-size]'
                        )}
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 truncate text-sm">
                          {t('detail.overview.tags.dialog.createTag', { name: searchText })}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </ScrollArea>
            </div>
          </PopoverContent>
        </Popover>

        {/* 现有标签：chip 列表，右侧 × 删除 */}
        <ScrollArea className="h-[150px] rounded-md border border-border bg-input/10">
          <div className="flex flex-wrap content-start gap-1.5 p-2">
            {draft.length === 0 ? (
              <div className="w-full self-center text-center text-xs text-muted-foreground">
                {t('detail.overview.tags.empty')}
              </div>
            ) : (
              draft.map((key) => {
                const label =
                  localLabels[key] ??
                  tagDisplay[key] ??
                  (key.startsWith('@user:') ? key.slice(6) : key)
                return (
                  <Badge
                    key={key}
                    variant="secondary"
                    className="items-center gap-1 px-2 py-1 text-xs"
                  >
                    <span className="select-none">{label}</span>
                    <button
                      type="button"
                      aria-label={t('detail.overview.tags.dialog.removeTag', { name: label })}
                      onClick={() => removeKey(key)}
                      className="pointer-events-auto -mr-1 ml-0.5 rounded-sm p-0.5 opacity-70 hover:opacity-100 hover:text-destructive focus:outline-none"
                    >
                      <X className="h-3 w-3 pointer-events-auto" />
                    </button>
                  </Badge>
                )
              })
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            {t('utils:common.cancel')}
          </Button>
          <Button type="button" onClick={() => void handleConfirm()}>
            {t('utils:common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
