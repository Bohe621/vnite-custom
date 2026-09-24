import { Accordion, AccordionItem, AccordionTrigger } from '@ui/accordion'
import { ScrollArea } from '@ui/scroll-area'
import { useTranslation } from 'react-i18next'
import { LazyLoadComponent, trackWindowScroll } from 'react-lazy-load-image-component'
import { useConfigState } from '~/hooks'
import { filterGames, getAllValuesInKey, sortGames, useVisibleGameIds } from '~/stores/game'
import { cn } from '~/utils'
import { GameNav } from '../GameNav'
import { useGameListStore } from '../store'
import { AllGameComponent } from './AllGame'
import { GameListContent } from './GameListContent'
import { GroupSortSummary } from './GroupSortSummary'
import { NOT_IN_LIBRARY_GROUP_ID, NotInLibraryGame } from './NotInLibraryGame'
import { PlaceHolder } from './PlaceHolder'
import { RecentGames } from './RecentGames'

function OthersComponent({
  fieldName,
  scrollPosition
}: {
  fieldName: 'metadata.developers' | 'metadata.genres' // It can also be 'none'
  scrollPosition: { x: number; y: number }
}): React.JSX.Element {
  const [by] = useConfigState('game.gameList.sort.by')
  const [order] = useConfigState('game.gameList.sort.order')
  const [showAllGamesInGroup] = useConfigState('game.gameList.showAllGamesInGroup')
  const visibleGameIds = useVisibleGameIds()
  const { t } = useTranslation('game')
  const emptyAccordionName = {
    'metadata.developers': t('list.empty.developers'),
    'metadata.genres': t('list.empty.genres')
  }

  const fields = [...getAllValuesInKey(fieldName, visibleGameIds), '__empty__']
  const defaultValues = [...fields, 'all', 'recentGames', NOT_IN_LIBRARY_GROUP_ID]

  const setOpenValues = useGameListStore((s) => s.setOpenValues)
  const openValues = useGameListStore((s) => s.getOpenValues(fieldName))
  const handleAccordionChange = (v: string[]): void => {
    const valid = v.filter((key) => defaultValues.includes(key)) // Remove the zombie key in storge
    setOpenValues(fieldName, valid)
  }

  return (
    <ScrollArea
      scrollRestorationId="library-game-list"
      className={cn('w-full h-full pr-3 -mr-3 pb-1 pt-1')}
    >
      {defaultValues.length > 2 ? (
        <Accordion
          key={`${fieldName}`}
          value={openValues}
          onValueChange={handleAccordionChange}
          type="multiple"
          className={cn('w-full text-xs flex flex-col gap-2')}
        >
          {/* Recent Games */}
          <RecentGames />
          {/* Split games into their respective fields */}
          {(fieldName === 'metadata.developers' || fieldName === 'metadata.genres') &&
            fields.map((field) => {
              const gameIds = filterGames({ [fieldName]: [field] }, visibleGameIds)
              if (gameIds.length === 0) return <></>

              return (
                <AccordionItem key={field} value={field}>
                  <AccordionTrigger defaultChecked className={cn('text-xs p-1 pl-2')}>
                    <div className={cn('flex flex-row items-center justify-start gap-1')}>
                      <div className={cn('text-xs')}>
                        {field !== '__empty__' ? field : emptyAccordionName[fieldName]}
                      </div>
                      <GroupSortSummary gameIds={gameIds} by={by} />
                    </div>
                  </AccordionTrigger>
                  <GameListContent>
                    {sortGames(by, order, gameIds).map((game) => (
                      <LazyLoadComponent
                        key={`${game}`}
                        threshold={300}
                        scrollPosition={scrollPosition}
                        placeholder={
                          <PlaceHolder gameId={game} groupId={`${fieldName}:${field}`} />
                        }
                      >
                        <GameNav gameId={game} groupId={`${fieldName}:${field}`} />
                      </LazyLoadComponent>
                    ))}
                  </GameListContent>
                </AccordionItem>
              )
            })}

          {/* All Games */}
          {showAllGamesInGroup && <AllGameComponent scrollPosition={scrollPosition} />}

          {/* Games whose every version directory is gone */}
          <NotInLibraryGame scrollPosition={scrollPosition} />
        </Accordion>
      ) : (
        <Accordion
          key={`${fieldName}_no`}
          type="multiple"
          className={cn('w-full text-xs flex flex-col gap-2')}
          value={openValues}
          onValueChange={handleAccordionChange}
        >
          <RecentGames />
          <AllGameComponent scrollPosition={scrollPosition} />
          <NotInLibraryGame scrollPosition={scrollPosition} />
        </Accordion>
      )}
    </ScrollArea>
  )
}

export const Others = trackWindowScroll(OthersComponent)
