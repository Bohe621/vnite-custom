/**
 * "Records" tab of the game properties dialog — what the version workbench did to this game.
 *
 * Two lists, because only one of them can be undone:
 *
 * - **Ignored folders.** Every folder the user rejected. They are also what the scanner skips, so
 *   removing a record here un-ignores the folder: the next scan sees it again. That is the whole
 *   point of the tab — a wrong "ignore" has to be fixable somewhere.
 * - **Everything else** (merged entries, adopted folders). Read-only history: those actions already
 *   rewrote the library and cannot be replayed backwards.
 */
import type { VersionReviewLogItem, VersionReviewRecord } from '@appTypes/utils'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcManager } from '~/app/ipc'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/utils'

/** Local time, short form: the record is a log, not a data export. */
function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function Record({ gameId }: { gameId: string }): React.JSX.Element {
  const { t } = useTranslation('game')
  const [record, setRecord] = useState<VersionReviewRecord | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      setRecord(await ipcManager.invoke('version-review:get-record', gameId))
    } catch (error) {
      toast.error(
        t('detail.properties.record.notifications.error', {
          message: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }, [gameId, t])

  useEffect(() => {
    void load()
  }, [load])

  async function handleRemove(item: VersionReviewLogItem): Promise<void> {
    setBusyId(item.id)
    try {
      const result = await ipcManager.invoke('version-review:remove-record', gameId, item.id)
      setRecord(result.record)
      if (result.success) toast.success(t('detail.properties.record.notifications.removed'))
      else toast.error(result.error ?? t('detail.properties.record.notifications.removed'))
    } catch (error) {
      toast.error(
        t('detail.properties.record.notifications.error', {
          message: error instanceof Error ? error.message : String(error)
        })
      )
    } finally {
      setBusyId(null)
    }
  }

  async function handleClear(): Promise<void> {
    setClearOpen(false)
    try {
      const result = await ipcManager.invoke('version-review:clear-records', gameId)
      setRecord(result.record)
      if (result.success) toast.success(t('detail.properties.record.notifications.cleared'))
      else toast.error(result.error ?? t('detail.properties.record.notifications.cleared'))
    } catch (error) {
      toast.error(
        t('detail.properties.record.notifications.error', {
          message: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }

  const items = record?.items ?? []
  const ignored = items.filter((item) => item.action === 'ignore-folder')
  const history = items.filter((item) => item.action !== 'ignore-folder')

  /** One line of the read-only list. */
  const describe = (item: VersionReviewLogItem): string => {
    if (item.action === 'merge-entries') {
      return t('detail.properties.record.actions.merge', {
        count: item.mergedTitles?.length ?? item.mergedGameIds?.length ?? 0,
        names: (item.mergedTitles ?? []).join('、')
      })
    }
    return t('detail.properties.record.actions.adopt', {
      directory: item.directory ?? '',
      name: item.versionName ?? ''
    })
  }

  const RemoveButton = ({
    item,
    label
  }: {
    item: VersionReviewLogItem
    label: string
  }): React.JSX.Element => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="delete"
          size="icon"
          className={cn('size-7 shrink-0')}
          disabled={busyId === item.id}
          onClick={() => void handleRemove(item)}
        >
          <span className={cn('icon-[mdi--delete-outline] h-4 w-4')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <div className={cn('flex flex-col gap-4')}>
      <Card>
        <CardHeader className={cn('flex flex-row items-center justify-between gap-3')}>
          <CardTitle className={cn('flex items-center gap-2')}>
            {t('detail.properties.record.ignored.title')}
            {ignored.length > 0 && (
              <Badge variant="secondary">
                {t('detail.properties.record.ignored.count', { count: ignored.length })}
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={ignored.length === 0}
            onClick={() => setClearOpen(true)}
          >
            <span className={cn('icon-[mdi--delete-sweep-outline] h-4 w-4')} />
            {t('detail.properties.record.ignored.clear')}
          </Button>
        </CardHeader>
        <CardContent className={cn('flex flex-col gap-2')}>
          {ignored.length === 0 ? (
            <div className={cn('py-6 text-center text-sm text-muted-foreground')}>
              {t('detail.properties.record.ignored.empty')}
            </div>
          ) : (
            <>
              <div className={cn('text-xs text-muted-foreground')}>
                {t('detail.properties.record.ignored.hint')}
              </div>
              {ignored.map((item) => (
                <div key={item.id} className={cn('flex items-start gap-3 rounded-md border p-3')}>
                  <span
                    className={cn(
                      'icon-[mdi--folder-off-outline] mt-0.5 h-4 w-4 shrink-0 text-muted-foreground'
                    )}
                  />
                  <div className={cn('min-w-0 flex-1')}>
                    <div className={cn('font-mono text-xs break-all')}>{item.directory}</div>
                    <div
                      className={cn(
                        'mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'
                      )}
                    >
                      <Badge variant={item.active ? 'secondary' : 'outline'}>
                        {item.active
                          ? t('detail.properties.record.ignored.statusActive')
                          : t('detail.properties.record.ignored.statusReleased')}
                      </Badge>
                      <span>{formatTime(item.at)}</span>
                    </div>
                  </div>
                  <RemoveButton item={item} label={t('detail.properties.record.ignored.remove')} />
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.properties.record.history.title')}</CardTitle>
        </CardHeader>
        <CardContent className={cn('flex flex-col gap-2')}>
          {history.length === 0 ? (
            <div className={cn('py-6 text-center text-sm text-muted-foreground')}>
              {t('detail.properties.record.history.empty')}
            </div>
          ) : (
            history.map((item) => (
              <div key={item.id} className={cn('flex items-start gap-3 rounded-md border p-3')}>
                <span
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground',
                    item.action === 'merge-entries'
                      ? 'icon-[mdi--source-merge]'
                      : 'icon-[mdi--folder-arrow-right-outline]'
                  )}
                />
                <div className={cn('min-w-0 flex-1')}>
                  <div className={cn('text-xs break-all')}>{describe(item)}</div>
                  <div className={cn('mt-1.5 text-xs text-muted-foreground')}>
                    {formatTime(item.at)}
                  </div>
                </div>
                <RemoveButton item={item} label={t('detail.properties.record.history.remove')} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('detail.properties.record.ignored.clearConfirm.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('detail.properties.record.ignored.clearConfirm.description', {
                count: ignored.length
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('utils:common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleClear()}>
              {t('detail.properties.record.ignored.clear')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
