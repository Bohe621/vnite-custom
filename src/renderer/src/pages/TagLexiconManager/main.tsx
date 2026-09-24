import type {
  TagLexiconEntity,
  TagLexiconQueryResult,
  TagLexiconQueryScope,
  TagLexiconState
} from '@appTypes/models'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'
import { MergeDialog } from '~/components/TagLexicon/MergeDialog'
import { MigrateTagsDialog } from '~/components/TagLexicon/MigrateTagsDialog'
import { MoveSourceDialog } from '~/components/TagLexicon/MoveSourceDialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/ui/select'
import { cn, copyWithToast } from '~/utils'

/** 一次最多渲染多少条，避免 2700+ 条一次铺满 DOM */
const PAGE_SIZE = 200

/**
 * 常用语言，供词库分语言维护。
 * 取值与 scraper:vndb.languageCode 对齐（zh-Hans / zh-Hant），
 * 以便同一个语言代码既能在界面上选，又能被翻译链路直接命中。
 */
const COMMON_LANGUAGES = ['zh-Hans', 'zh-Hant', 'ja', 'en', 'ko', 'fr', 'it', 'ru']

/** 一行里最多展示几个「其他语言」的译名，超出的折成 +N */
const MAX_OTHER_NAMES = 2

/** 把各源原始串压成一行摘要，便于一眼看出这条实体被哪些源用过 */
function summarizeSources(entity: TagLexiconEntity): string {
  const parts: string[] = []
  for (const [provider, list] of Object.entries(entity.src)) {
    if (list.length > 0) parts.push(`${provider}: ${list.join(', ')}`)
  }
  return parts.join('  ·  ')
}

/** 单条实体的编辑行：本地 draft + 失焦提交 */
function EntityRow({
  entity,
  lang,
  selected,
  onRowClick,
  onSave,
  onDelete,
  onAction
}: {
  entity: TagLexiconEntity
  lang: string
  /** 是否被 Ctrl/⌘ 多选选中（用于合并） */
  selected: boolean
  onRowClick: (entity: TagLexiconEntity, event: React.MouseEvent) => void
  onSave: (key: string, value: string) => Promise<void>
  onDelete: (key: string) => Promise<void>
  /** 「合并到…」/「修正索引…」：实际操作在页面层用对话框完成 */
  onAction: (action: 'merge' | 'move', entity: TagLexiconEntity) => void
}): React.JSX.Element {
  const { t } = useTranslation('tagLexicon')
  const saved = entity.names[lang] ?? ''
  const [value, setValue] = useState(saved)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(saved)
  }, [saved])

  const dirty = value !== saved

  const commit = async (): Promise<void> => {
    if (!dirty) return
    setSaving(true)
    try {
      await onSave(entity.key, value)
    } finally {
      setSaving(false)
    }
  }

  const sourceText = summarizeSources(entity)
  const otherNames = useMemo(
    () => Object.entries(entity.names).filter(([code]) => code !== lang),
    [entity.names, lang]
  )

  return (
    <div
      onClick={(event) => {
        // 行里有译名输入框和「更多操作」按钮，点它们不算选行
        if ((event.target as HTMLElement).closest('input, button')) return
        onRowClick(entity, event)
      }}
      className={cn(
        'relative flex items-center gap-3 px-4 py-2 border-b last:border-b-0',
        selected && 'bg-primary/15'
      )}
    >
      {/* 选中标记：绝对定位，不占布局，免得行内文字左右跳 */}
      {selected && <span className={cn('absolute inset-y-0 left-0 w-1 bg-primary')} />}
      {/*
        ⚠️ 左格必须带 `[contain:inline-size]`。
        里面的 `.truncate` 是 nowrap，其 min-content = 整串文字的宽度；Radix 的 ScrollArea
        会在视口里塞一层 `display: table`（内联样式，`react-scroll-area/dist/index.js` 里写死）
        做 shrink-to-fit，于是「所有行的 min-content 之和」会把这张表顶到 ~2853px ——
        右侧「其他语言」列、`内置` 徽标、删除按钮全被挤出视口裁掉。
        实测（ja / 已有译名，53 行）：基线 min-content 2853；只把左格文字改回可换行 → 1423；
        只给左格加 `contain: inline-size` → 1423。`min-w-0`、`overflow-hidden`、行根
        `overflow-hidden`、给 input 加 `max-width` 都**无效**（都不影响固有尺寸计算）。
        本格宽度是固定的 30%，本来就与内容无关，所以 inline-size 包含是语义正确的写法。
      */}
      <div className={cn('w-[30%] min-w-0 [contain:inline-size]')}>
        <div
          className={cn('font-mono text-[11px] truncate text-muted-foreground')}
          title={entity.key}
        >
          {entity.key}
        </div>
        <div
          className={cn('text-[11px] truncate text-muted-foreground/70')}
          title={sourceText || t('list.noSource')}
        >
          {sourceText || t('list.noSource')}
        </div>
      </div>

      <Input
        value={value}
        // ⚠️ 占位符**不能**用 entity.display —— 它是「已含回退」的显示名，
        // 选 ja 时会填进英文，看着像这条已经有 ja 译名了。英文原名在右侧
        // 「其他语言」里本来就看得到，这里只标明「未翻译」即可。
        placeholder={t('list.noTranslation')}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className={cn('flex-1 bg-input/20', dirty && 'bg-primary/10')}
        disabled={saving}
      />

      <div className={cn('w-[24%] min-w-0 flex flex-wrap justify-end gap-1')}>
        {otherNames.slice(0, MAX_OTHER_NAMES).map(([code, name]) => (
          <span
            key={code}
            className={cn(
              'max-w-full truncate rounded border px-1.5 py-px text-[10px] text-muted-foreground'
            )}
            title={`${code}: ${name}`}
          >
            {code} {name}
          </span>
        ))}
        {otherNames.length > MAX_OTHER_NAMES && (
          <span className={cn('text-[10px] text-muted-foreground/70')}>
            +{otherNames.length - MAX_OTHER_NAMES}
          </span>
        )}
      </div>

      <Badge
        variant={entity.origin === 'user' ? 'default' : 'outline'}
        className={cn('shrink-0 text-[10px]')}
      >
        {entity.origin === 'user' ? t('list.sourceUser') : t('list.sourceBuiltin')}
      </Badge>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className={cn('shrink-0 w-7 h-7')}
            disabled={saving}
            title={t('actions.rowActions')}
          >
            <span className={cn('w-4 h-4 icon-[mdi--dots-horizontal]')}></span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent align="end">
            {/*
              改挂与合并的分工（见 MoveSourceDialog / MergeDialog 的注释）：
              改挂只动线索、两条实体都在；合并是把整条实体并掉、原 key 靠 redirect 解析。
              「自动归并并错了」（DLsite 的作品形式被并进 vndb 的另一条实体）用改挂，
              「压根不该单独存在」用合并。
            */}
            <DropdownMenuItem onClick={() => onAction('move', entity)}>
              <span className={cn('w-4 h-4 mr-2 icon-[mdi--swap-horizontal]')}></span>
              {t('actions.moveSource')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction('merge', entity)}>
              <span className={cn('w-4 h-4 mr-2 icon-[mdi--call-merge]')}></span>
              {t('actions.merge')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(entity.key)}>
              <span className={cn('w-4 h-4 mr-2 icon-[mdi--delete-outline]')}></span>
              {t('actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
    </div>
  )
}

export function TagLexiconManager(): React.JSX.Element {
  const { t } = useTranslation('tagLexicon')
  const [state, setState] = useState<TagLexiconState | null>(null)
  const [lang, setLang] = useState('')
  /**
   * 列表范围。默认 `withName` —— 这个页面的语义就是「分语言维护」：
   * 列表显示的是**所选语言真正有译名的那部分**实体，中间一列直接改它的译名。
   * 要补译名就切到 `missingName`，要看全部就切 `all`。
   */
  const [scope, setScope] = useState<TagLexiconQueryScope>('withName')
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState<TagLexiconQueryResult>({ total: 0, entities: [] })
  const [probeRaw, setProbeRaw] = useState('')
  const [probeResult, setProbeResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * 行操作的目标实体（「合并到…」/「改挂线索…」共用）。
   * 两个对话框都要「这条实体的显示名」做文案，所以在打开时就快照下来 ——
   * 操作完列表会重查，届时这条实体可能已经不在了（合并掉的那条）。
   */
  const [actionTarget, setActionTarget] = useState<{
    mode: 'merge' | 'move'
    key: string
    label: string
  } | null>(null)
  /** 全库标签迁移（一次性维护动作）的对话框 */
  const [migrateOpen, setMigrateOpen] = useState(false)
  /**
   * 列表里 Ctrl/⌘ 点选中的实体。**有序**：最后点的那条排在最后，多选合并拿它当默认目标。
   *
   * 选 1 条时也会浮出那条操作条（合并按钮先禁用），提示「还能多选」；
   * 单条合并仍然走行菜单的「合并到…」——那条路径可以自由搜目标（不限于选中的）。
   */
  const [selected, setSelected] = useState<string[]>([])
  /** 多选合并对话框的输入（打开时把选中集合快照下来，合并过程中列表变化不影响它） */
  const [bulkKeys, setBulkKeys] = useState<string[] | null>(null)

  const refreshState = async (): Promise<void> => {
    const next = await ipcManager.invoke('tag-lexicon:get-state')
    setState(next)
    setLang((prev) => prev || next.currentLang)
  }

  // scope 从闭包读，所以这里签名不含 scope；调用处（保存/删除/重载/导入后重查）
  // 都不需要改，也不会漏传 —— 那些处理函数每次渲染都会拿到当前的 scope。
  const runQuery = async (targetLang: string, kw: string): Promise<void> => {
    if (!targetLang) return
    const next = await ipcManager.invoke('tag-lexicon:query', {
      lang: targetLang,
      keyword: kw,
      scope,
      limit: PAGE_SIZE
    })
    setResult(next)
  }

  useEffect(() => {
    refreshState().catch((error) => {
      console.error('Failed to load tag lexicon state:', error)
      toast.error(t('notifications.loadError'))
    })
  }, [])

  // 语言 / 范围切换立即查询；关键词变化走 300ms 防抖
  useEffect(() => {
    if (!lang) return
    const timer = setTimeout(
      () => {
        runQuery(lang, keyword).catch((error) => console.error('Query failed:', error))
      },
      keyword ? 300 : 0
    )
    return () => clearTimeout(timer)
  }, [lang, keyword, scope])

  const languageOptions = useMemo(() => {
    const set = new Set<string>(COMMON_LANGUAGES)
    if (state?.currentLang) set.add(state.currentLang)
    state?.languages.forEach((item) => set.add(item))
    if (lang) set.add(lang)
    return Array.from(set)
  }, [state, lang])

  const handleSave = async (key: string, value: string): Promise<void> => {
    await ipcManager.invoke('tag-lexicon:set-name', { key, lang, value })
    toast.success(t('notifications.saved'))
    // 改完名字后 origin / display 都可能变化，重查一次保证界面与实际一致
    await runQuery(lang, keyword)
    await refreshState()
  }

  const handleDelete = async (key: string): Promise<void> => {
    await ipcManager.invoke('tag-lexicon:delete-tag', { key })
    // 删掉的那条可能还在选择里，顺手摘掉，免得浮出的按钮指向不存在的实体
    setSelected((prev) => prev.filter((item) => item !== key))
    toast.success(t('notifications.deleted'))
    await runQuery(lang, keyword)
    await refreshState()
  }

  /**
   * 行点击：Ctrl/⌘ + 点 = 切换选中；普通点击 = 清空选择。
   * 行的其它交互（改译名、更多操作）在 `EntityRow` 里已经排除掉了。
   */
  const handleRowClick = (entity: TagLexiconEntity, event: React.MouseEvent): void => {
    if (!event.ctrlKey && !event.metaKey) {
      if (selected.length > 0) setSelected([])
      return
    }
    setSelected((prev) =>
      prev.includes(entity.key) ? prev.filter((item) => item !== entity.key) : [...prev, entity.key]
    )
  }

  const handleRowAction = (action: 'merge' | 'move', entity: TagLexiconEntity): void => {
    setActionTarget({ mode: action, key: entity.key, label: entity.display })
  }

  /** 合并/修正索引都改动了词库结构，列表与统计都要重查 */
  const handleActionDone = async (): Promise<void> => {
    // 源实体已经被并掉了，选择里留着它没有意义
    setSelected([])
    await runQuery(lang, keyword)
    await refreshState()
  }

  const handleReload = async (): Promise<void> => {
    setBusy(true)
    try {
      await ipcManager.invoke('tag-lexicon:reload')
      await refreshState()
      await runQuery(lang, keyword)
      toast.success(t('notifications.reloaded'))
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await ipcManager.invoke('tag-lexicon:export', { lang })
      if (res.canceled) {
        toast.info(t('notifications.canceled'))
        return
      }
      toast.success(t('notifications.exportSuccess', { path: res.path }))
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await ipcManager.invoke('tag-lexicon:import', { mode: 'merge' })
      if (res.canceled) {
        toast.info(t('notifications.canceled'))
        return
      }
      toast.success(t('notifications.importSuccess', { added: res.added, updated: res.updated }))
      await refreshState()
      await runQuery(lang, keyword)
    } catch (error) {
      console.error('Failed to import tag lexicon:', error)
      toast.error(t('notifications.loadError'))
    } finally {
      setBusy(false)
    }
  }

  /** 试算：粘贴一条抓取源返回的标签原文，看会归到哪条实体 */
  const handleProbe = async (): Promise<void> => {
    const raw = probeRaw.trim()
    if (!raw) {
      setProbeResult(null)
      return
    }
    const key = await ipcManager.invoke('tag-lexicon:resolve', { raw })
    setProbeResult(key ?? t('probe.miss'))
  }

  return (
    <div className={cn('relative flex flex-col w-full h-full bg-transparent')}>
      <ScrollArea className={cn('w-full h-full')} scrollRestorationId="tag-lexicon-manager">
        <div className={cn('px-6 py-[34px] pb-6')}>
          <div className={cn('flex items-center justify-between mb-2')}>
            <h2 className={cn('text-2xl font-bold')}>{t('title')}</h2>
          </div>
          <p className={cn('mb-4 text-xs text-muted-foreground')}>{t('description')}</p>

          <Card className={cn('p-4 rounded-lg mb-4')}>
            <div className={cn('flex flex-wrap items-center justify-between gap-4')}>
              <div className={cn('flex flex-wrap items-center gap-3')}>
                <Badge variant="outline" className={cn('flex items-center gap-1')}>
                  <span className={cn('w-3.5 h-3.5 icon-[mdi--database-outline]')}></span>
                  <span>
                    {t('status.tags')}: {state?.tagCount ?? 0}
                  </span>
                </Badge>
                <Badge variant="outline" className={cn('flex items-center gap-1')}>
                  <span className={cn('w-3.5 h-3.5 icon-[mdi--pencil-outline]')}></span>
                  <span>
                    {t('status.user')}: {state?.userCount ?? 0}
                  </span>
                </Badge>
                <Badge variant="outline" className={cn('flex items-center gap-1')}>
                  <span className={cn('w-3.5 h-3.5 icon-[mdi--source-merge]')}></span>
                  <span>
                    {t('status.merged')}: {state?.mergedCount ?? 0}
                  </span>
                </Badge>
                <Badge variant="outline" className={cn('flex items-center gap-1')}>
                  <span className={cn('w-3.5 h-3.5 icon-[mdi--translate]')}></span>
                  <span>
                    {t('status.fallback')}: {(state?.fallback ?? []).join(' → ') || '-'}
                  </span>
                </Badge>
                <Select value={lang} onValueChange={setLang}>
                  <SelectTrigger className={cn('h-8 w-[150px]')}>
                    <SelectValue placeholder={t('status.language')} />
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={scope}
                  onValueChange={(value) => setScope(value as TagLexiconQueryScope)}
                >
                  <SelectTrigger className={cn('h-8 w-[180px]')}>
                    <SelectValue placeholder={t('scope.label')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('scope.all')}</SelectItem>
                    <SelectItem value="withName">{t('scope.withName', { lang })}</SelectItem>
                    <SelectItem value="missingName">{t('scope.missingName', { lang })}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className={cn('flex gap-2')}>
                <Button size="sm" variant="outline" disabled={busy} onClick={handleReload}>
                  <span className={cn('w-4 h-4 mr-2 icon-[mdi--refresh]')}></span>
                  {t('actions.reload')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={handleImport}>
                  <span className={cn('w-4 h-4 mr-2 icon-[mdi--import]')}></span>
                  {t('actions.import')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={handleExport}>
                  <span className={cn('w-4 h-4 mr-2 icon-[mdi--export]')}></span>
                  {t('actions.export')}
                </Button>
                {/*
                  一次性维护动作：把库里还是老原文的标签换成 key。
                  平时用不到（新写入的数据本来就是 key），历史数据迁完就不必再点。
                */}
                <Button size="sm" variant="outline" onClick={() => setMigrateOpen(true)}>
                  <span className={cn('w-4 h-4 mr-2 icon-[mdi--database-sync-outline]')}></span>
                  {t('actions.migrate')}
                </Button>
              </div>
            </div>

            <div className={cn('mt-3 flex items-center gap-1 text-xs text-muted-foreground')}>
              <span className={cn('truncate')} title={state?.path}>
                {t('status.file')}: {state?.path}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className={cn('shrink-0 w-6 h-6')}
                onClick={() => state?.path && copyWithToast(state.path)}
              >
                <span className={cn('w-3.5 h-3.5 icon-[mdi--content-copy]')}></span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className={cn('shrink-0 w-6 h-6')}
                onClick={() =>
                  state?.path && ipcManager.invoke('system:open-path-in-explorer', state.path)
                }
              >
                <span className={cn('w-3.5 h-3.5 icon-[mdi--folder-open-outline]')}></span>
              </Button>
            </div>

            <div className={cn('mt-3 flex items-center gap-3 border-t pt-3')}>
              <Input
                value={probeRaw}
                placeholder={t('probe.placeholder')}
                onChange={(e) => {
                  setProbeRaw(e.target.value)
                  setProbeResult(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleProbe().catch(console.error)
                }}
                className={cn('h-8 flex-1 bg-input/20')}
              />
              <div
                className={cn('min-w-[220px] truncate font-mono text-[11px] text-muted-foreground')}
                title={probeResult ?? ''}
              >
                {probeResult ?? ''}
              </div>
            </div>
          </Card>

          <Card className={cn('flex flex-col rounded-lg p-0 gap-0 overflow-hidden')}>
            <div
              className={cn(
                'flex flex-wrap items-center gap-3 p-4 border-b bg-muted/[calc(var(--glass-opacity)/2)]'
              )}
            >
              <Input
                value={keyword}
                placeholder={t('search.placeholder')}
                onChange={(e) => setKeyword(e.target.value)}
                className={cn('w-[320px] max-w-full bg-input/20')}
              />
              <div className={cn('text-xs text-muted-foreground')}>
                {t('list.hint', { total: result.total, shown: result.entities.length })}
              </div>
              <div className={cn('text-xs text-muted-foreground/70')}>
                {t('status.coverage', {
                  lang,
                  count: state?.languageCounts?.[lang] ?? 0,
                  total: state?.tagCount ?? 0
                })}
              </div>
            </div>

            <div className={cn('flex flex-col')}>
              {result.entities.length > 0 ? (
                result.entities.map((entity) => (
                  <EntityRow
                    key={entity.key}
                    entity={entity}
                    lang={lang}
                    selected={selected.includes(entity.key)}
                    onRowClick={handleRowClick}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onAction={handleRowAction}
                  />
                ))
              ) : (
                <div className={cn('p-10 text-center text-sm text-muted-foreground')}>
                  {t('list.empty')}
                </div>
              )}
            </div>
          </Card>
        </div>
      </ScrollArea>

      {/*
        右下角浮出的多选操作条。Ctrl/⌘ 点列表里的行（可选任意多条）就会冒出来。
        选 1 条时按钮先禁用 —— 让人知道「还能多选」，而不是以为点错了。
      */}
      {selected.length > 0 && (
        <div
          className={cn(
            'absolute right-6 bottom-6 z-40 flex items-center gap-2 rounded-lg border',
            'bg-popover px-3 py-2 shadow-lg'
          )}
        >
          <span className={cn('text-xs text-muted-foreground')}>
            {t('selection.count', { count: selected.length })}
          </span>
          <Button
            size="sm"
            disabled={selected.length < 2}
            onClick={() => setBulkKeys(selected)}
            title={selected.length < 2 ? t('selection.needMore') : undefined}
          >
            <span className={cn('w-4 h-4 mr-1.5 icon-[mdi--call-merge]')}></span>
            {t('selection.merge')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            {t('selection.clear')}
          </Button>
        </div>
      )}

      {/* 行操作的两个对话框：合并（整条并掉）/ 修正索引（只挪线索） */}
      {actionTarget?.mode === 'merge' && (
        <MergeDialog
          open
          onOpenChange={(open) => !open && setActionTarget(null)}
          fromKeys={[actionTarget.key]}
          fromLabel={actionTarget.label}
          onDone={() => void handleActionDone()}
        />
      )}
      {actionTarget?.mode === 'move' && (
        <MoveSourceDialog
          open
          onOpenChange={(open) => !open && setActionTarget(null)}
          fromKey={actionTarget.key}
          fromLabel={actionTarget.label}
          onDone={() => void handleActionDone()}
        />
      )}
      {/* 多选合并：目标在选中的这几条里挑，默认最后点选的那条 */}
      {bulkKeys && (
        <MergeDialog
          open
          onOpenChange={(open) => !open && setBulkKeys(null)}
          fromKeys={bulkKeys}
          presetTarget={bulkKeys[bulkKeys.length - 1]}
          onDone={() => void handleActionDone()}
        />
      )}
      {migrateOpen && (
        <MigrateTagsDialog
          open
          onOpenChange={setMigrateOpen}
          onDone={() => void handleActionDone()}
        />
      )}
    </div>
  )
}
