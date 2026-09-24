import { useConfigState } from '~/hooks'
import { cn } from '~/utils'

/**
 * Lazy-load placeholder for a single game entry.
 *
 * It must occupy the same slot size as the real `GameNav` in both display modes,
 * otherwise the scroll offset would jump once the real item is mounted.
 */
export function PlaceHolder({
  gameId,
  groupId
}: {
  gameId: string
  groupId: string
}): React.JSX.Element {
  const [displayMode] = useConfigState('game.gameList.displayMode')
  const isGrid = displayMode === 'grid'

  return (
    <div
      // `p-1` mirrors the padding of the poster card so the placeholder occupies exactly
      // the same slot height as the real item (220px at the default library bar width).
      className={cn('rounded-none bg-transparent', isGrid ? 'w-full p-1' : 'p-3 h-5')}
      data-game-id={gameId}
      data-group-id={groupId}
    >
      {isGrid && (
        <>
          <div
            className={cn(
              'w-full aspect-[2/3] rounded-lg bg-accent/[calc(var(--glass-opacity)/2)]'
            )}
          />
          {/* Reserve the same height as the two-line game name */}
          <div className={cn('h-8 mt-1')} />
        </>
      )}
    </div>
  )
}
