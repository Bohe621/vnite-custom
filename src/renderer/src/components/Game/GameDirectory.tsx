import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcManager } from '~/app/ipc'
import { useGameLocalState } from '~/hooks'
import { cn } from '~/utils'

/**
 * Where the launch version is installed, as a quiet one-liner between the header's name row and its
 * record row. Clicking it reveals the folder in the file manager.
 *
 * The folder it names must be the one the main process considers the entry's own, otherwise the
 * scanner, the conflict workbench and this line would disagree about the same game. `ownedDirectories`
 * decides that with the precedence copied here: the user-set root, then the executable's own folder,
 * then the folder the scanner marked.
 *
 * The caller places it in the header's own `flex-col` and caps its width (`max-w-[750px]`), so a deep
 * path cannot stretch it across the header and the two `gap-5`s it sits between stay 20px.
 */
export function GameDirectory({
  gameId,
  className
}: {
  gameId: string
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation('game')
  // Outside the properties dialog there is no version scope, so these read the top-level mirror —
  // which always describes the launch version. The folder therefore follows the version picker.
  const [gamePath] = useGameLocalState(gameId, 'path.gamePath')
  const [rootPath] = useGameLocalState(gameId, 'utils.rootPath')
  const [markPath] = useGameLocalState(gameId, 'utils.markPath')

  const directory = useMemo((): string => {
    const root = (rootPath ?? '').trim()
    if (root) return root

    const executable = (gamePath ?? '').trim().replace(/\\/g, '/')
    const cut = executable.lastIndexOf('/')
    if (cut > 0) return executable.slice(0, cut)

    return (markPath ?? '').trim()
  }, [rootPath, gamePath, markPath])

  // `w-full` pairs with the caller's `max-w-[750px]`: the row fills whatever the header gives it up to
  // that cap. The inner span is a flex item, which is what `truncate` needs to see (an inline span has
  // no box to ellipsise), so the path is cut instead of stretching the header.
  //
  // `pt-[5px]` / `pb-[5px]` are part of this row's own look, but they also feed the row's height
  // (16 + 5 + 5 = 26px) — the header compensates for that with negative margins, so changing either
  // value means re-deriving them over there.
  //
  // `relative` is deliberate: the row is taller than the 20px slot it lives in, so it overlaps the
  // record block below. Being a positioned element makes it paint (and hit-test) above that block,
  // so the overlap belongs to this row rather than being covered by the next sibling.
  return (
    <div
      title={directory || undefined}
      onClick={
        directory
          ? (): void => void ipcManager.invoke('system:open-path-in-explorer', directory)
          : undefined
      }
      className={cn(
        'relative flex w-full min-w-0 flex-row items-center gap-2 pt-[5px] pb-[5px] text-xs text-[#676767]',
        directory && 'cursor-pointer hover:text-foreground',
        className
      )}
    >
      <span className={cn('icon-[mdi--folder-outline] w-4 h-4 shrink-0')}></span>
      <span className={cn('min-w-0 truncate')}>
        {directory || t('detail.overview.record.gameDirectoryEmpty')}
      </span>
    </div>
  )
}
