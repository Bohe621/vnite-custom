import { useTranslation } from 'react-i18next'
import { LazyLoadComponent } from 'react-lazy-load-image-component'
import { AccordionItem, AccordionTrigger } from '~/components/ui/accordion'
import { useConfigState } from '~/hooks'
import { sortGames, useNotInLibraryGameIds, useVisibleGameIds } from '~/stores/game'
import { cn } from '~/utils'
import { GameNav } from '../GameNav'
import { GameListContent } from './GameListContent'
import { GroupSortSummary } from './GroupSortSummary'
import { PlaceHolder } from './PlaceHolder'

/**
 * Accordion key for this group. Parents keep it in their open-values whitelist, otherwise the
 * accordion state would be stripped on the next change and the group could never be opened.
 */
export const NOT_IN_LIBRARY_GROUP_ID = 'notInLibrary'

/**
 * Records whose every version directory is gone from disk: still in the database, no files left.
 *
 * They are removed from "all games" (see `AllGame`) so the library reflects what can actually be
 * launched, but they stay reachable here — collections, recent games and search keep showing them
 * as well, so a game is never lost just because its folder moved. Double-clicking a row runs the
 * normal launch flow, which asks for the new location and repairs the path.
 *
 * `scrollPosition` comes from the parent, which is the one wrapped in `trackWindowScroll`.
 */
export function NotInLibraryGame({
  scrollPosition
}: {
  scrollPosition: { x: number; y: number }
}): React.JSX.Element {
  const [by] = useConfigState('game.gameList.sort.by')
  const [order] = useConfigState('game.gameList.sort.order')
  const visibleGameIds = useVisibleGameIds()
  const games = sortGames(by, order, useNotInLibraryGameIds(visibleGameIds))
  const { t } = useTranslation('game')

  // Nothing to report is the normal case, so the group is hidden entirely rather than shown empty.
  if (games.length === 0) return <></>

  return (
    <AccordionItem value={NOT_IN_LIBRARY_GROUP_ID}>
      <AccordionTrigger className={cn('text-xs p-1 pl-2')}>
        <div className={cn('flex flex-row items-center justify-start gap-1')}>
          <div className={cn('text-xs')}>{t('list.notInLibrary.title')}</div>
          <GroupSortSummary gameIds={games} by={by} />
        </div>
      </AccordionTrigger>
      <GameListContent>
        {games.map((gameId) => (
          <LazyLoadComponent
            key={gameId}
            threshold={300}
            scrollPosition={scrollPosition}
            placeholder={<PlaceHolder gameId={gameId} groupId={NOT_IN_LIBRARY_GROUP_ID} />}
          >
            <GameNav gameId={gameId} groupId={NOT_IN_LIBRARY_GROUP_ID} />
          </LazyLoadComponent>
        ))}
      </GameListContent>
    </AccordionItem>
  )
}
