import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LazyLoadComponent, trackWindowScroll } from 'react-lazy-load-image-component'
import { AccordionItem, AccordionTrigger } from '~/components/ui/accordion'
import { useConfigState } from '~/hooks'
import { sortGames, useNotInLibraryGameIds, useVisibleGameIds } from '~/stores/game'
import { cn } from '~/utils'
import { GameNav } from '../GameNav'
import { GameListContent } from './GameListContent'
import { GroupSortSummary } from './GroupSortSummary'
import { PlaceHolder } from './PlaceHolder'

export function AllGameComponent({
  scrollPosition
}: {
  scrollPosition: { x: number; y: number }
}): React.JSX.Element {
  const [by] = useConfigState('game.gameList.sort.by')
  const [order] = useConfigState('game.gameList.sort.order')
  const visibleGameIds = useVisibleGameIds()
  const notInLibraryGameIds = useNotInLibraryGameIds(visibleGameIds)

  // "All games" means the ones actually in the library. Records whose every version directory is
  // gone get their own group instead (see `NotInLibraryGame`).
  const libraryGameIds = useMemo(() => {
    const missing = new Set(notInLibraryGameIds)
    return visibleGameIds.filter((gameId) => !missing.has(gameId))
  }, [visibleGameIds, notInLibraryGameIds])

  const games = sortGames(by, order, libraryGameIds)
  const { t } = useTranslation('game')

  return (
    <AccordionItem value="all">
      <AccordionTrigger className={cn('text-xs p-1 pl-2')}>
        <div className={cn('flex flex-row items-center justify-start gap-1')}>
          <div className={cn('text-xs')}>{t('list.all.title')}</div>
          <GroupSortSummary gameIds={games} by={by} />
        </div>
      </AccordionTrigger>
      <GameListContent>
        {games.map((gameId) => (
          <LazyLoadComponent
            key={gameId}
            threshold={300}
            scrollPosition={scrollPosition}
            placeholder={<PlaceHolder gameId={gameId} groupId="all" />}
          >
            <GameNav gameId={gameId} groupId="all" />
          </LazyLoadComponent>
        ))}
      </GameListContent>
    </AccordionItem>
  )
}

export const AllGame = trackWindowScroll(AllGameComponent)
