'use client'

import { ChevronDown } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@ui/alert-dialog'
import { Button } from '@ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@ui/command'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@ui/dialog'
import { Input } from '@ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@ui/popover'
import { cn } from '~/utils'
import { useGameState, useGameVersions } from '~/hooks'
import { getGameLocalStore } from '~/stores/game/gameLocalStoreFactory'

/** Which of the two selectors this is — they look alike but mean different things. */
export type VersionSelecterScope = 'edit' | 'launch'

/**
 * Version picker for a game.
 *
 * `scope="launch"` (game detail page) picks the version that will actually be launched.
 * `scope="edit"` (properties dialog) only picks which copy the launcher/path tabs are editing;
 * it never changes the launch version.
 *
 * Both variants also expose create / rename / delete.
 */
export function VersionSelecter({
  gameId,
  value,
  onChange,
  scope,
  className
}: {
  gameId: string
  value: string
  onChange: (versionId: string) => void
  scope: VersionSelecterScope
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation('game')
  const [open, setOpen] = React.useState(false)
  const { versions, currentVersionId, createVersion, renameVersion, deleteVersion } =
    useGameVersions(gameId)
  const [metadataVersion] = useGameState(gameId, 'metadata.version')

  const [nameDialog, setNameDialog] = React.useState<{
    mode: 'create' | 'rename'
    value: string
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null)
  const [isBusy, setIsBusy] = React.useState(false)

  const fallbackName = metadataVersion.trim() || t('detail.properties.versions.defaultName')
  const displayName = React.useCallback(
    (version: { name: string }): string =>
      version.name.trim() || metadataVersion.trim() || t('detail.properties.versions.defaultName'),
    [metadataVersion, t]
  )

  const selected = versions.find((version) => version.id === value) ?? versions[0]

  function openCreateDialog(): void {
    setNameDialog({ mode: 'create', value: fallbackName })
    setOpen(false)
  }

  function openRenameDialog(): void {
    setNameDialog({ mode: 'rename', value: selected?.name.trim() || fallbackName })
    setOpen(false)
  }

  async function confirmName(nextName: string): Promise<void> {
    if (!nameDialog) return
    const name = nextName.trim()
    if (!name) return
    setIsBusy(true)
    try {
      if (nameDialog.mode === 'create') {
        const versionId = await createVersion(name)
        onChange(versionId)
      } else if (selected) {
        await renameVersion(selected.id, name)
      }
      setNameDialog(null)
    } catch (error) {
      toast.error(String(error))
    } finally {
      setIsBusy(false)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return
    setIsBusy(true)
    try {
      const deletingSelected = deleteTarget === value
      await deleteVersion(deleteTarget)
      if (deletingSelected) {
        const fresh = getGameLocalStore(gameId).getState().getData()
        if (fresh?.currentVersionId) onChange(fresh.currentVersionId)
      }
      setDeleteTarget(null)
    } catch (error) {
      toast.error(String(error))
    } finally {
      setIsBusy(false)
    }
  }

  const deleteTargetName = ((): string => {
    const target = versions.find((version) => version.id === deleteTarget)
    return target ? displayName(target) : ''
  })()

  return (
    <>
      {/* Non-modal on purpose. In modal mode the DismissableLayer consumes the trigger's
          pointerdown and closes the popover first, so the click that follows toggles it straight
          back open — the button then looks dead: it opens once and never closes again. Non-modal
          keeps the expected click-to-toggle (and a click outside still dismisses). */}
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger className={cn(className)} asChild>
          <Button
            variant="outline"
            size={'sm'}
            role="combobox"
            aria-expanded={open}
            className={cn('min-w-[130px] max-w-[220px] justify-between gap-2')}
            title={t(
              scope === 'launch'
                ? 'detail.properties.versions.scope.launch'
                : 'detail.properties.versions.scope.edit'
            )}
          >
            <span className={cn('flex items-center gap-1.5 min-w-0')}>
              {/* `layers-triple` reads as "several copies"; the old `play-circle` looked like a
                  second start button next to StartGame. The edit scope keeps the tag, so the two
                  selectors stay distinguishable at a glance. */}
              <span
                className={cn(
                  'shrink-0 w-4 h-4',
                  scope === 'launch'
                    ? 'icon-[mdi--layers-triple-outline]'
                    : 'icon-[mdi--tag-outline]'
                )}
              ></span>
              <span className={cn('truncate')}>
                {selected ? displayName(selected) : t('detail.properties.versions.unnamed')}
              </span>
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 opacity-50 transition-transform',
                open && 'rotate-180'
              )}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="max-w-[260px] p-0" align="end">
          <Command>
            <CommandInput placeholder={t('detail.properties.versions.search')} />
            <CommandList className="scrollbar-base-thin">
              <CommandEmpty>{t('detail.properties.versions.noResults')}</CommandEmpty>
              <CommandGroup>
                {versions.map((version) => (
                  <CommandItem
                    key={version.id}
                    value={version.id}
                    keywords={[displayName(version)]}
                    onSelect={() => {
                      onChange(version.id)
                      setOpen(false)
                    }}
                  >
                    <span className={cn('min-w-0 flex-1 truncate')}>{displayName(version)}</span>
                    {version.id === value && (
                      <span className={cn('icon-[mdi--check] w-4 h-4 shrink-0')}></span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem value="create-version" onSelect={openCreateDialog}>
                  <span className={cn('icon-[mdi--plus] w-4 h-4')}></span>
                  {t('detail.properties.versions.create')}
                </CommandItem>
                <CommandItem value="rename-version" onSelect={openRenameDialog}>
                  <span className={cn('icon-[mdi--pencil-outline] w-4 h-4')}></span>
                  {t('detail.properties.versions.rename')}
                </CommandItem>
                <CommandItem
                  value="delete-version"
                  disabled={versions.length <= 1}
                  onSelect={() => {
                    if (selected) setDeleteTarget(selected.id)
                    setOpen(false)
                  }}
                >
                  <span className={cn('icon-[mdi--delete-outline] w-4 h-4')}></span>
                  {t('detail.properties.versions.delete')}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog
        open={nameDialog !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setNameDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {nameDialog?.mode === 'create'
                ? t('detail.properties.versions.createTitle')
                : t('detail.properties.versions.renameTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className={cn('flex flex-col gap-3')}>
            {nameDialog?.mode === 'create' && (
              <div className={cn('text-sm text-muted-foreground')}>
                {t('detail.properties.versions.createDescription', {
                  source: selected ? displayName(selected) : t('detail.properties.versions.unnamed')
                })}
              </div>
            )}
            <Input
              autoFocus
              value={nameDialog?.value ?? ''}
              placeholder={t('detail.properties.versions.namePlaceholder')}
              onChange={(e) =>
                setNameDialog((prev) => (prev ? { ...prev, value: e.target.value } : prev))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmName(nameDialog?.value ?? '')
              }}
            />
          </div>
          <DialogFooter>
            <Button variant={'ghost'} onClick={() => setNameDialog(null)}>
              {t('utils:common.cancel')}
            </Button>
            <Button
              className={cn('ml-2')}
              disabled={isBusy || !nameDialog?.value.trim()}
              onClick={() => void confirmName(nameDialog?.value ?? '')}
            >
              {t('utils:common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('detail.properties.versions.deleteTitle', { name: deleteTargetName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget === currentVersionId
                ? t('detail.properties.versions.deleteLaunchDescription')
                : t('detail.properties.versions.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>{t('utils:common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={isBusy} onClick={() => void confirmDelete()}>
              {t('utils:common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
