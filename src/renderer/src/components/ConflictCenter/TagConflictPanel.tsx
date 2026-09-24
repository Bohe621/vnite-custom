import type { TagLexiconConflict, TagLexiconEntity } from '@appTypes/models'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcManager } from '~/app/ipc'
import { clueSummary } from '~/components/TagLexicon/clues'
import { MergeDialog } from '~/components/TagLexicon/MergeDialog'
import { MoveSourceDialog } from '~/components/TagLexicon/MoveSourceDialog'
import {
  compareEntities,
  nameSummary,
  type SynonymComparison,
  type SynonymVerdict
} from '~/components/TagLexicon/synonym'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { ScrollArea } from '~/components/ui/scroll-area'
import { useTagConflictStore } from '~/stores/tagConflictStore'
import { cn } from '~/utils'

/** 「当前名字」是谁定的：内置表 / 用户自己改过 / 抓取自动积累的 */
function useOriginLabel(): (origin: TagLexiconConflict['currentOrigin']) => string {
  const { t } = useTranslation('adder')
  return (origin) => {
    if (origin === 'user') return t('tagConflict.origin.user')
    if (origin === 'fetched') return t('tagConflict.origin.fetched')
    return t('tagConflict.origin.builtin')
  }
}

/**
 * 疑似同义的判定档位 → 文案与徽标样式。
 *
 * `same` / `alias` 是**强证据**（英文名一致，或一侧的英文名就是另一侧的别名 ——
 * 后者如 DLsite 的 `Living Together` 命中 vndb `Under the Same Roof` 的别名）；
 * `similar` 是前缀/包含关系（`Shota` ⊂ `Shotacon`），要看一眼；
 * `different` 要格外小心，说明词面相同但英文概念不同（`Corrupted Morals` vs `Falling to Evil`）。
 */
function useVerdictLabel(): (verdict: SynonymVerdict) => string {
  const { t } = useTranslation('adder')
  return (verdict) => t(`tagConflict.compare.verdict.${verdict}`)
}

function verdictBadgeVariant(verdict: SynonymVerdict): 'default' | 'secondary' | 'outline' {
  if (verdict === 'same' || verdict === 'alias') return 'default'
  if (verdict === 'similar') return 'secondary'
  return 'outline'
}

/** 冲突行里的「跨语言对比」块：两边各语言译名 + 线索 + 英文名判定 */
function ComparisonBlock({
  comparison,
  minted,
  existing,
  provider
}: {
  comparison: SynonymComparison
  minted: TagLexiconEntity | undefined
  existing: TagLexiconEntity | undefined
  provider: string
}): React.JSX.Element {
  const { t } = useTranslation('adder')
  const verdictLabel = useVerdictLabel()

  const side = (
    label: string,
    entity: TagLexiconEntity | undefined,
    fallbackKey: string | null
  ): React.JSX.Element => (
    <div className={cn('flex min-w-0 flex-col gap-0.5')}>
      <span className={cn('text-muted-foreground')}>{label}</span>
      <span className={cn('break-words')}>{nameSummary(entity) || '—'}</span>
      <span className={cn('break-all text-muted-foreground')}>
        {clueSummary(entity) || fallbackKey || '—'}
      </span>
    </div>
  )

  return (
    <div className={cn('flex min-w-0 flex-col gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs')}>
      {side(t('tagConflict.compare.minted', { provider }), minted, null)}
      {side(t('tagConflict.compare.existing'), existing, null)}
      <div className={cn('flex flex-wrap items-center gap-2')}>
        <Badge variant={verdictBadgeVariant(comparison.verdict)} className={cn('text-[10px]')}>
          {verdictLabel(comparison.verdict)}
        </Badge>
        {comparison.matches.map((match, index) => (
          <span key={index} className={cn('break-words text-muted-foreground')}>
            {t('tagConflict.compare.evidence', { a: match.a.value, b: match.b.value })}
          </span>
        ))}
      </div>
      {comparison.verdict === 'unknown' && (
        <span className={cn('break-words text-muted-foreground')}>
          {t('tagConflict.compare.noComparableHint')}
        </span>
      )}
    </div>
  )
}

/**
 * 标签冲突面板（「冲突管理」的第二个页签）。
 *
 * 冲突从哪来：入库**不再按文本自动归并**（`resolveOrMint` 只认源内稳定 id），于是两种
 * 「该由人决定」的情形浮出来 —— 两个概念撞同一个词（`duplicate`）、抓取写法与该语言已有
 * 译名不一致（`name`）。自动归并的时代这两种都是静默处理的：前者静默并错，后者静默丢弃。
 *
 * 每一行给的是「现状 + 抓到的写法 + 两个按钮」，不提供批量处理：这类决定的价值就在于逐条看过。
 */
export function TagConflictPanel(): React.JSX.Element {
  const { t } = useTranslation('adder')
  const originLabel = useOriginLabel()
  const conflicts = useTagConflictStore((state) => state.conflicts)
  const refresh = useTagConflictStore((state) => state.refresh)
  const resolve = useTagConflictStore((state) => state.resolve)

  const [entities, setEntities] = useState<Record<string, TagLexiconEntity>>({})
  const [showIgnored, setShowIgnored] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<TagLexiconConflict | null>(null)
  /**
   * 「合并…」打开的目标选择对话框。
   *
   * 冲突行的合并**不再一键直并**了：`resolveConflict(id,'accept')` 对 duplicate 走的是
   * `merge(key, other)`（不传 `preferFrom`），两边同语言都有译名时**静默取目标的**，
   * 用户没有任何选择余地。改成打开 `MergeDialog`（预填对面那条、目标可改）之后，
   * 合并这一侧才和「改挂」一样能在「译名预览」里逐语言选保留哪个（2026-09-24 指出）。
   */
  const [mergeDialog, setMergeDialog] = useState<TagLexiconConflict | null>(null)
  /** 改挂/断开后手动推进：冲突列表没变时 `keys` 也不变，光靠它取不到新线索 */
  const [entityToken, setEntityToken] = useState(0)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 冲突行要显示双方实体的名字与线索，批量取一次（key 变了才重取）
  const keys = useMemo(() => {
    const set = new Set<string>()
    for (const conflict of conflicts) {
      set.add(conflict.key)
      if (conflict.other) set.add(conflict.other)
    }
    return [...set].sort()
  }, [conflicts])

  useEffect(() => {
    if (keys.length === 0) {
      setEntities({})
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const loaded = await ipcManager.invoke('tag-lexicon:get-entities', { keys })
        if (cancelled) return
        setEntities(Object.fromEntries(loaded.map((entity) => [entity.key, entity])))
      } catch (error) {
        console.error('[TagConflict] Failed to load the entities:', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [keys, entityToken])

  const pending = conflicts.filter((conflict) => conflict.status === 'pending')
  const ignored = conflicts.filter((conflict) => conflict.status === 'ignored')
  const visible = showIgnored ? ignored : pending

  const handleResolve = async (
    conflict: TagLexiconConflict,
    action: 'accept' | 'keep'
  ): Promise<void> => {
    setBusyId(conflict.id)
    try {
      await resolve(conflict.id, action)
    } finally {
      setBusyId(null)
    }
  }

  /** 冲突语言下的名字（拿不到就退回 display —— 它已含回退链） */
  const nameOf = (key: string | undefined, lang: string): string => {
    if (!key) return ''
    const entity = entities[key]
    if (!entity) return key
    return entity.names[lang] ?? entity.display
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-3')}>
      <div className={cn('flex items-center gap-2')}>
        <div className={cn('flex items-center gap-1')}>
          <Button
            size="sm"
            variant={showIgnored ? 'ghost' : 'secondary'}
            onClick={() => setShowIgnored(false)}
          >
            {t('tagConflict.tabs.pending', { count: pending.length })}
          </Button>
          <Button
            size="sm"
            variant={showIgnored ? 'secondary' : 'ghost'}
            onClick={() => setShowIgnored(true)}
          >
            {t('tagConflict.tabs.ignored', { count: ignored.length })}
          </Button>
        </div>
        {/* 这里的措辞决定用户点哪个按钮 —— 曾经有人把「合并成一条」读成「把这条整理掉」，
            于是对「判断不是同义」的情况点了合并（正好把不该并的两条并掉）。
            所以把「改挂 vs 合并」的区别写在决策发生的地方，而不是只藏在对话框里。 */}
        <div className={cn('flex flex-col gap-0.5 text-xs text-muted-foreground')}>
          <span>{showIgnored ? t('tagConflict.ignoredHint') : t('tagConflict.pendingHint')}</span>
          {!showIgnored && (
            <span className={cn('text-[11px] text-muted-foreground/80')}>
              {t('tagConflict.moveVsMerge')}
            </span>
          )}
        </div>
      </div>

      <ScrollArea className={cn('min-h-0 flex-1 pr-3')}>
        {visible.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {showIgnored ? t('tagConflict.emptyIgnored') : t('tagConflict.empty')}
          </div>
        ) : (
          <div className={cn('flex flex-col gap-2 pb-2')}>
            {visible.map((conflict) => {
              const isDuplicate = conflict.kind === 'duplicate'
              const isBusy = busyId === conflict.id
              return (
                <div
                  key={conflict.id}
                  className={cn('flex flex-col gap-2 rounded-lg border border-border p-3')}
                >
                  <div className={cn('flex flex-wrap items-center gap-2')}>
                    <Badge variant="outline" className={cn('text-[10px]')}>
                      {conflict.lang}
                    </Badge>
                    <Badge
                      variant={isDuplicate ? 'destructive' : 'secondary'}
                      className={cn('text-[10px]')}
                    >
                      {isDuplicate ? t('tagConflict.kind.duplicate') : t('tagConflict.kind.name')}
                    </Badge>
                    <span className={cn('text-xs text-muted-foreground')}>
                      {t('tagConflict.fromSource', { provider: conflict.provider })}
                    </span>
                    {conflict.status === 'ignored' && (
                      <Badge variant="outline" className={cn('text-[10px]')}>
                        {t('tagConflict.ignoredBadge')}
                      </Badge>
                    )}
                  </div>

                  {isDuplicate ? (
                    <>
                      <div className={cn('text-sm')}>
                        {t('tagConflict.duplicate.summary', {
                          lang: conflict.lang,
                          name: conflict.incoming
                        })}
                      </div>
                      <ComparisonBlock
                        comparison={compareEntities(
                          entities[conflict.key],
                          entities[conflict.other ?? ''],
                          conflict.lang
                        )}
                        minted={entities[conflict.key]}
                        existing={entities[conflict.other ?? '']}
                        provider={conflict.provider}
                      />
                    </>
                  ) : (
                    <div className={cn('flex flex-col gap-1 text-sm')}>
                      <div className={cn('flex flex-wrap items-center gap-2')}>
                        <span className={cn('text-xs text-muted-foreground')}>
                          {t('tagConflict.name.current')}
                        </span>
                        <span>{conflict.current}</span>
                        <Badge variant="outline" className={cn('text-[10px]')}>
                          {originLabel(conflict.currentOrigin)}
                        </Badge>
                      </div>
                      <div className={cn('flex flex-wrap items-center gap-2')}>
                        <span className={cn('text-xs text-muted-foreground')}>
                          {t('tagConflict.name.incoming', { provider: conflict.provider })}
                        </span>
                        <span>{conflict.incoming}</span>
                      </div>
                    </div>
                  )}

                  <div className={cn('flex flex-wrap items-center gap-2')}>
                    {conflict.status === 'pending' ? (
                      <>
                        <Button
                          size="sm"
                          disabled={isBusy}
                          onClick={() =>
                            isDuplicate
                              ? setMergeDialog(conflict)
                              : void handleResolve(conflict, 'accept')
                          }
                        >
                          {isDuplicate
                            ? t('tagConflict.action.merge')
                            : t('tagConflict.action.acceptName')}
                        </Button>
                        {isDuplicate && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => setMoveTarget(conflict)}
                          >
                            {t('tagConflict.action.moveSource')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => void handleResolve(conflict, 'keep')}
                        >
                          {isDuplicate
                            ? t('tagConflict.action.keepBoth')
                            : t('tagConflict.action.keepCurrent')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() =>
                          isDuplicate
                            ? setMergeDialog(conflict)
                            : void handleResolve(conflict, 'accept')
                        }
                      >
                        {isDuplicate
                          ? t('tagConflict.action.merge')
                          : t('tagConflict.action.acceptName')}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>

      {moveTarget && (
        <MoveSourceDialog
          open
          onOpenChange={(open) => !open && setMoveTarget(null)}
          fromKey={moveTarget.key}
          fromLabel={nameOf(moveTarget.key, moveTarget.lang)}
          presetTarget={moveTarget.other ?? null}
          onDone={() => {
            void refresh()
            setEntityToken((token) => token + 1)
          }}
        />
      )}

      {/* 条件渲染（而不是常挂 + open 开关）：卸载即重置对话框内部的 target 选择 */}
      {mergeDialog && (
        <MergeDialog
          open
          onOpenChange={(open) => !open && setMergeDialog(null)}
          fromKeys={[mergeDialog.key]}
          fromLabel={nameOf(mergeDialog.key, mergeDialog.lang)}
          presetTarget={mergeDialog.other ?? null}
          onDone={() => {
            void refresh()
            setEntityToken((token) => token + 1)
          }}
        />
      )}
    </div>
  )
}
