import type { GameTagMigrationResult } from '@appTypes/models'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'
import { Badge } from '~/components/ui/badge'
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
import { ScrollArea } from '~/components/ui/scroll-area'
import { cn } from '~/utils'

/**
 * 把全库游戏文档里还没迁移的标签原文换成实体 key（一次性维护动作）。
 *
 * 打开就先跑一次 **dry-run**，把影响面摆出来（多少游戏会变、多少值认得出、多少认不出），
 * 而不是直接开写 —— 这个动作会改全库文档，必须先能看一眼。
 *
 * 「认不出的也铸成新标签」默认开着：不铸的话它们保持原样（表现与迁移前一致，只是没被统一），
 * 迁移的价值就只剩识别得出的那部分；铸了之后至少全库口径一致，以后扫描同类标签会走
 * `duplicate` 冲突让人决定要不要合并。
 */
export function MigrateTagsDialog({
  open,
  onOpenChange,
  onDone
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}): React.JSX.Element {
  const { t } = useTranslation('tagLexicon')
  const [preview, setPreview] = useState<GameTagMigrationResult | null>(null)
  const [mintUnknown, setMintUnknown] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  const runPreview = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    try {
      setPreview(await ipcManager.invoke('tag-lexicon:migrate-game-tags', { dryRun: true }))
    } catch (error) {
      console.error('[TagLexicon] Failed to preview the tag migration:', error)
      toast.error(t('migrate.previewFailed'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!open) return
    void runPreview()
  }, [open, runPreview])

  const handleRun = async (): Promise<void> => {
    setIsRunning(true)
    try {
      const result = await ipcManager.invoke('tag-lexicon:migrate-game-tags', {
        dryRun: false,
        mintUnknown
      })
      toast.success(
        t('migrate.notification.done', {
          games: result.gamesChanged,
          resolved: result.resolved,
          minted: result.minted
        })
      )
      onOpenChange(false)
      onDone?.()
    } catch (error) {
      console.error('[TagLexicon] Failed to migrate the game tags:', error)
      toast.error(t('migrate.notification.failed'))
    } finally {
      setIsRunning(false)
    }
  }

  const willChange = preview ? preview.resolved + (mintUnknown ? preview.unknown : 0) : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('w-[620px] max-w-[90vw]')}>
        <DialogHeader>
          <DialogTitle>{t('migrate.title')}</DialogTitle>
          <DialogDescription>{t('migrate.description')}</DialogDescription>
        </DialogHeader>

        {isLoading || !preview ? (
          <div className={cn('py-10 text-center text-sm text-muted-foreground')}>
            {t('migrate.previewing')}
          </div>
        ) : (
          <div className={cn('flex flex-col gap-3')}>
            <div className={cn('flex flex-wrap gap-2')}>
              <Badge variant="outline">{t('migrate.stat.games', { count: preview.games })}</Badge>
              <Badge variant="secondary">
                {t('migrate.stat.changing', { count: preview.gamesChanged })}
              </Badge>
              <Badge variant="outline">{t('migrate.stat.values', { count: preview.values })}</Badge>
              <Badge variant="outline">
                {t('migrate.stat.alreadyKey', { count: preview.alreadyKey })}
              </Badge>
              <Badge variant="default">
                {t('migrate.stat.resolved', { count: preview.resolved })}
              </Badge>
              <Badge variant="destructive">
                {t('migrate.stat.unknown', { count: preview.unknown })}
              </Badge>
            </div>

            <label className={cn('flex cursor-pointer items-start gap-2 text-sm')}>
              <Checkbox
                checked={mintUnknown}
                onCheckedChange={(checked) => setMintUnknown(checked === true)}
              />
              <span className={cn('flex flex-col gap-0.5')}>
                <span>{t('migrate.mintUnknown')}</span>
                <span className={cn('text-xs text-muted-foreground')}>
                  {t('migrate.mintUnknownHint', { count: preview.unknownDistinct })}
                </span>
              </span>
            </label>

            {preview.unknownTop.length > 0 && (
              <div className={cn('flex flex-col gap-1')}>
                <span className={cn('text-xs font-medium text-muted-foreground')}>
                  {t('migrate.unknownTop')}
                </span>
                <div className={cn('flex flex-wrap gap-1')}>
                  {preview.unknownTop.map((item) => (
                    <span
                      key={item.raw}
                      className={cn(
                        'rounded border px-1.5 py-px text-[11px] text-muted-foreground'
                      )}
                    >
                      {item.raw} ×{item.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {preview.samples.length > 0 && (
              <div className={cn('flex min-h-0 flex-col gap-1')}>
                <span className={cn('text-xs font-medium text-muted-foreground')}>
                  {t('migrate.samples')}
                </span>
                <ScrollArea className={cn('h-[140px] rounded-md border border-border')}>
                  <div className={cn('flex flex-col gap-2 p-2')}>
                    {preview.samples.map((sample) => (
                      <div key={sample.gameId} className={cn('flex flex-col gap-0.5 text-[11px]')}>
                        <span className={cn('truncate font-medium')}>{sample.name}</span>
                        <span className={cn('break-all text-muted-foreground')}>
                          {sample.before.join(' / ')}
                        </span>
                        <span className={cn('break-all text-primary')}>
                          {sample.after.join(' / ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className={cn('text-xs text-muted-foreground')}>
              {t('migrate.willChange', { count: willChange })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button disabled={isLoading || isRunning || !preview} onClick={handleRun}>
            {isRunning ? t('actions.saving') : t('migrate.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
