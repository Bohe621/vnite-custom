import type { TagLexiconEntity } from '@appTypes/models'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '~/components/ui/dialog'
import { cn } from '~/utils'
import { EntityPicker } from './EntityPicker'

/**
 * 改挂：把「某条实体上某个源的全部线索」挪到另一条实体上。
 *
 * 单位是**源**而不是单条原始串 —— 一条实体在一个源上只对应一个概念，而 `src` 与 `ids`
 * 是两个平行数组、下标并不一一对应（DLsite 的「角色扮演」与「ロールプレイング」共用一个
 * `type:RPG`），所以只能整块挪。落地的 IPC 也是这个粒度（`tag-lexicon:move-source`）。
 *
 * 典型场景就是「自动归并并错了」：DLsite 的作品形式被并进 vndb 的另一条实体，
 * 需要把它挂到正确的实体上。
 */
export function MoveSourceDialog({
  open,
  onOpenChange,
  fromKey,
  fromLabel,
  presetTarget,
  onDone
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  fromKey: string
  /** 源实体的显示名，只用于文案 */
  fromLabel: string
  /** 已知的正确目标（冲突面板从 `duplicate` 冲突进来时就是它） */
  presetTarget?: string | null
  onDone?: () => void
}): React.JSX.Element {
  const { t } = useTranslation('tagLexicon')
  const [entity, setEntity] = useState<TagLexiconEntity | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState<string | null>(presetTarget ?? null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open || !fromKey) return
    let cancelled = false
    setTarget(presetTarget ?? null)
    setSelected(new Set())
    setEntity(null)
    // 读取期间不能显示「没有来源线索」—— 那是在断言一个还没拿到的结论
    setIsLoading(true)

    void (async () => {
      try {
        const [loaded] = await ipcManager.invoke('tag-lexicon:get-entities', { keys: [fromKey] })
        if (cancelled) return
        setEntity(loaded ?? null)
      } catch (error) {
        console.error('[TagLexicon] Failed to load the entity:', error)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, fromKey, presetTarget])

  /** 每个源一块：`src` 与 `ids` 合起来展示，但选中/移动的单位是源名 */
  const blocks = (() => {
    if (!entity) return [] as { provider: string; clues: string[] }[]
    const providers = new Set([...Object.keys(entity.src), ...Object.keys(entity.ids)])
    return [...providers].map((provider) => ({
      provider,
      clues: [...(entity.src[provider] ?? []), ...(entity.ids[provider] ?? [])]
    }))
  })()

  const toggle = useCallback((provider: string, checked: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(provider)
      else next.delete(provider)
      return next
    })
  }, [])

  /**
   * 操作结果的补充说明。
   *
   * `blocked` 非空 = 这个源的部分（或全部）线索来自内置表，摘了也会在下次 `rebuild()`
   * 里加回来；`shell` = 源实体改挂/断开后已经没有任何来源线索（只剩名字）。
   * 这两件事以前完全不说，用户只能自己猜「到底成功没有」。
   */
  const describeOutcome = (blocked: number, shell: boolean): string | undefined => {
    const parts: string[] = []
    if (blocked > 0) parts.push(t('move.notification.partiallyBlocked', { count: blocked }))
    if (shell) parts.push(t('move.notification.shellHint', { name: fromLabel }))
    return parts.length > 0 ? parts.join(' ') : undefined
  }

  /** 目标实体的显示名，只用于反馈文案 */
  const displayNameOf = async (key: string): Promise<string> => {
    try {
      const [loaded] = await ipcManager.invoke('tag-lexicon:get-entities', { keys: [key] })
      return loaded?.display ?? key
    } catch {
      return key
    }
  }

  const handleConfirm = async (): Promise<void> => {
    if (!target || selected.size === 0) return
    setIsSaving(true)
    try {
      const targetName = await displayNameOf(target)
      let moved = 0
      let blockedSources = 0
      let shell = false

      // 逐个源串行：每次都会 rebuild + 落盘，并行只会互相覆盖
      for (const provider of selected) {
        const result = await ipcManager.invoke('tag-lexicon:move-source', {
          from: fromKey,
          into: target,
          provider
        })
        if (result.moved.src.length > 0 || result.moved.ids.length > 0) moved++
        if (result.blocked.src.length > 0 || result.blocked.ids.length > 0) blockedSources++
        shell = shell || result.sourceIsShell
      }

      if (moved === 0) {
        toast.error(t('move.notification.builtinOnly'))
      } else {
        toast.success(t('move.notification.moved', { count: moved, name: targetName }), {
          description: describeOutcome(blockedSources, shell)
        })
      }
      onOpenChange(false)
      onDone?.()
    } catch (error) {
      console.error('[TagLexicon] Failed to move the sources:', error)
      toast.error(t('move.notification.failed'))
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * 直接断开：不改挂到别处，只是让这个源以后不再命中这条实体。
   * 下一次扫描该源时它会按自己的 id / 文本重新落位（需要的话铸一条自己的实体）。
   */
  const handleDetach = async (): Promise<void> => {
    if (selected.size === 0) return
    setIsSaving(true)
    try {
      let detached = 0
      let blockedSources = 0
      let shell = false

      for (const provider of selected) {
        const result = await ipcManager.invoke('tag-lexicon:remove-source', {
          key: fromKey,
          provider
        })
        if (result.detached.src.length > 0 || result.detached.ids.length > 0) detached++
        if (result.blocked.src.length > 0 || result.blocked.ids.length > 0) blockedSources++
        shell = shell || result.sourceIsShell
      }

      if (detached === 0) {
        toast.error(t('move.notification.builtinOnly'))
      } else {
        toast.success(t('move.notification.detached', { count: detached }), {
          description: describeOutcome(blockedSources, shell)
        })
      }
      onOpenChange(false)
      onDone?.()
    } catch (error) {
      console.error('[TagLexicon] Failed to detach the sources:', error)
      toast.error(t('move.notification.failed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('w-[560px] max-w-[90vw]')}>
        <DialogHeader>
          <DialogTitle>{t('move.title')}</DialogTitle>
          {/* 实体名可以很长（vndb 里最长的 80+ 字符），必须允许换行，否则会顶出对话框 */}
          <DialogDescription className={cn('break-words')}>
            {t('move.description', { name: fromLabel })}
          </DialogDescription>
        </DialogHeader>

        {/*
          `min-w-0` + 高度上限：线索可以很长（实测最长 458 字符），别让对话框顶宽/顶出屏幕。
          ⚠️ `px-1` 是给**聚焦环留空间**的：`overflow-y-auto` 会把横向也算成 auto，于是
          里面贴着边（输入框默认 `w-full`）的控件聚焦时那圈 `ring-[3px]` 会被两侧裁掉
          （用户：「目标标签的输入框选中时两边有部分被截断了」，实测边距确实是 0）。
        */}
        <div className={cn('flex max-h-[70vh] min-w-0 flex-col gap-4 overflow-y-auto px-1')}>
          <div className={cn('flex min-w-0 flex-col gap-1.5')}>
            <span className={cn('text-xs font-medium text-muted-foreground')}>
              {t('move.sources')}
            </span>
            {isLoading ? (
              <div className={cn('text-xs text-muted-foreground')}>{t('move.loading')}</div>
            ) : blocks.length === 0 ? (
              <div className={cn('text-xs text-muted-foreground')}>{t('move.noSources')}</div>
            ) : (
              <div className={cn('flex flex-col gap-1')}>
                {blocks.map((block) => {
                  // 用 `items-center` 而不是 `items-start`：后者让勾选框贴在第一行顶部，
                  // 与整块的中点差 12px（实测），看着像没对齐。
                  return (
                    <label
                      key={block.provider}
                      className={cn(
                        'flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5',
                        'hover:bg-accent'
                      )}
                    >
                      {/* 边框加深：默认的 `border-input` 是 `rgb(224,224,224)`，压在
                          `bg-background`(245) 上几乎看不出轮廓（用户：「勾选框颜色也要调一下
                          看不见」）。这里是对话框里唯一的选择控件，必须一眼可见。 */}
                      <Checkbox
                        checked={selected.has(block.provider)}
                        onCheckedChange={(checked) => toggle(block.provider, checked === true)}
                        className={cn('border-muted-foreground')}
                      />
                      <span className={cn('flex min-w-0 flex-col gap-0.5')}>
                        <span className={cn('text-sm')}>{block.provider}</span>
                        <span className={cn('break-all text-[11px] text-muted-foreground')}>
                          {block.clues.join(' · ')}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
            {/* 改挂只搬 `src`/`ids`，`names` 一个都不动 —— 这件事不说清，用户会以为
                源实体的译名会跟着过去（2026-09-24 被问到过）。译文归属见 i18n 文案。 */}
            {!isLoading && blocks.length > 0 && (
              <span className={cn('break-words text-[11px] text-muted-foreground/80')}>
                {t('move.namesStayHint')}
              </span>
            )}
          </div>

          <div className={cn('flex min-w-0 flex-col gap-1.5')}>
            <span className={cn('text-xs font-medium text-muted-foreground')}>
              {t('move.target')}
            </span>
            <EntityPicker
              value={target}
              onChange={setTarget}
              exclude={[fromKey]}
              lang={undefined}
              placeholder={t('move.targetPlaceholder')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button
            variant="outline"
            disabled={isSaving || selected.size === 0}
            onClick={handleDetach}
          >
            {t('move.detach')}
          </Button>
          <Button disabled={isSaving || !target || selected.size === 0} onClick={handleConfirm}>
            {isSaving ? t('actions.saving') : t('move.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
