import { AccordionContent } from '@ui/accordion'
import React from 'react'
import { useConfigState } from '~/hooks'
import { cn } from '~/utils'

/**
 * Shared container for one group of games inside the library game list.
 *
 * The layout follows `game.gameList.displayMode`:
 * - `grid` → auto-filling poster grid (rendered by `GameNav` in poster layout)
 * - `list` → vertical stack of compact rows (rendered by `GameNav` in row layout)
 *
 * Note: the grid template must stay in sync with `PlaceHolder`, otherwise the
 * lazy-load placeholders will not occupy the same slot size as the real item,
 * which causes the scroll position to jump while scrolling.
 */
export function GameListContent({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  const [displayMode] = useConfigState('game.gameList.displayMode')

  return (
    <AccordionContent
      className={cn(
        'rounded-none pt-1',
        displayMode === 'grid'
          ? 'grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 items-start justify-items-stretch'
          : 'flex flex-col gap-1',
        className
      )}
    >
      {children}
    </AccordionContent>
  )
}
