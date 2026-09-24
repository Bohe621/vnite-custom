import { NSFWFilterMode } from '@appTypes/models'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@ui/select'
import { SeparatorDashed } from '@ui/separator-dashed'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LazyLoadComponent, trackWindowScroll } from 'react-lazy-load-image-component'
import { useGameBatchEditorStore } from '~/components/GameBatchEditor/store'
import { Button } from '~/components/ui/button'
import { ScrollArea } from '~/components/ui/scroll-area'
import { useConfigState } from '~/hooks'
import { useGameCollectionState } from '~/hooks/useGameCollectionState'
import { useGameCollectionStore } from '~/stores'
import { sortGames, useVisibleGameIds } from '~/stores/game'
import { cn } from '~/utils'
import { GamePoster } from './posters/GamePoster'
import { PlaceHolder } from './posters/PlaceHolder'
import { getShowcasePosterRowMetrics } from './posterGridMetrics'
import { ScrollToTopButton } from './ScrollToTopButton'

export type DragContextType = {
  isDraggingGlobal: boolean
  setIsDraggingGlobal: (dragging: boolean) => void
}

const DragContext = createContext<DragContextType | null>(null)

// eslint-disable-next-line
export const useDragContext = (): DragContextType => {
  const context = useContext(DragContext)
  return (
    context ?? {
      isDraggingGlobal: false,
      setIsDraggingGlobal: (): void => {}
    }
  )
}

export function CollectionGamesComponent({
  collectionId,
  scrollPosition
}: {
  collectionId: string
  scrollPosition: { x: number; y: number }
}): React.JSX.Element {
  const [by, setBy] = useGameCollectionState(collectionId, 'sortBy')
  const [order, setOrder] = useGameCollectionState(collectionId, 'sortOrder')
  const toggleOrder = (): void => {
    setOrder(order === 'asc' ? 'desc' : 'asc')
  }
  const { t } = useTranslation('game')
  const collections = useGameCollectionStore((state) => state.documents)
  const [nsfwFilterMode] = useConfigState('appearances.nsfwFilterMode')
  // Poster shape for the showcase lists: `portrait` (2:3) or `wide` (3:2)
  const [posterShape] = useConfigState('game.showcase.posterShape')
  const games = useVisibleGameIds(collections[collectionId]?.games)
  const sortedGames = by === 'custom' ? games : sortGames(by, order, games)
  const collectionName = collections[collectionId]?.name

  const [gridContentWidth, setGridContentWidth] = useState<number>(0)
  const gridContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Column count, card width and gap for the current grid width. Shared with the virtualized
  // "all games" wall so the two lists can never lay out differently.
  const rowMetrics = useMemo(
    () => getShowcasePosterRowMetrics(posterShape, gridContentWidth),
    [posterShape, gridContentWidth]
  )

  const selectGames = useGameBatchEditorStore((state) => state.selectGames)

  // Keyboard shortcut handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Check if any dialog element is active
      const isDialogActive =
        document.querySelector('dialog[open]') !== null ||
        document.querySelector('.modal.active') !== null ||
        document.querySelector('[role="dialog"]') !== null

      // When a dialog is open, do not execute shortcut key functions
      if (isDialogActive) {
        return
      }

      // Ctrl + A select all games
      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault()
        selectGames(games)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectGames, games])

  useEffect(() => {
    const gridContainer = gridContainerRef.current
    if (!gridContainer) return

    // Only the available width is measured; column count, card width and gap are derived from
    // it. Deriving means the poster shape toggle needs no re-attach: the metrics recompute
    // whenever `posterShape` changes even though the container width does not.
    const measureContentWidth = (): void => {
      const containerStyle = window.getComputedStyle(gridContainer)
      const paddingLeft = parseFloat(containerStyle.paddingLeft) || 0
      const paddingRight = parseFloat(containerStyle.paddingRight) || 0

      setGridContentWidth(Math.max(0, gridContainer.clientWidth - paddingLeft - paddingRight))
    }

    measureContentWidth()
    const observer = new ResizeObserver(measureContentWidth)
    observer.observe(gridContainer)

    return (): void => observer.disconnect()
  }, [])

  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false)

  return (
    <DragContext.Provider value={{ isDraggingGlobal, setIsDraggingGlobal }}>
      <div className={cn('flex flex-col gap-3 h-full bg-transparent pt-4')}>
        <div className={cn('flex flex-row gap-5 items-center justify-center pl-5 pt-2')}>
          <div className={cn('text-accent-foreground select-none flex-shrink-0')}>
            {collectionName}
          </div>
          <div className={cn('flex flex-row gap-1 items-center justify-center select-none')}>
            <div className={cn('text-sm')}>{t('showcase.sorting.title')}</div>
            {/* Sort By */}
            <Select value={by} onValueChange={setBy} defaultValue="name">
              <SelectTrigger className={cn('w-[130px] h-[26px] text-xs border-0')}>
                <SelectValue placeholder="Select a fruit" className={cn('text-xs')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t('showcase.sorting.label')}</SelectLabel>
                  <SelectItem value="metadata.name">
                    {t('showcase.sorting.options.name')}
                  </SelectItem>
                  <SelectItem value="metadata.sortName">
                    {t('showcase.sorting.options.sortName')}
                  </SelectItem>
                  <SelectItem value="metadata.releaseDate">
                    {t('showcase.sorting.options.releaseDate')}
                  </SelectItem>
                  <SelectItem value="record.lastRunDate">
                    {t('showcase.sorting.options.lastRunDate')}
                  </SelectItem>
                  <SelectItem value="record.addDate">
                    {t('showcase.sorting.options.addDate')}
                  </SelectItem>
                  <SelectItem value="record.playTime">
                    {t('showcase.sorting.options.playTime')}
                  </SelectItem>
                  <SelectItem value="custom">{t('showcase.sorting.options.custom')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {/* Toggle Order */}
          {by !== 'custom' && (
            <Button
              variant={'thirdary'}
              size={'icon'}
              className={cn('h-[26px] w-[26px] -ml-3')}
              onClick={toggleOrder}
            >
              {order === 'asc' ? (
                <span className={cn('icon-[mdi--arrow-up] w-4 h-4')}></span>
              ) : (
                <span className={cn('icon-[mdi--arrow-down] w-4 h-4')}></span>
              )}
            </Button>
          )}
          <SeparatorDashed className="border-border" />
        </div>
        <ScrollArea
          ref={scrollAreaRef}
          scrollRestorationId="library-collection-games"
          className={cn('w-full flex-1 min-h-0 pb-2')}
        >
          <div className={cn('w-full flex flex-col gap-1')}>
            {/* Game List Container */}
            <div
              ref={gridContainerRef}
              className={cn(
                'grid',
                // '3xl:grid-cols-[repeat(auto-fill,176px)]',
                'gap-y-[30px] w-full',
                // `spread` (portrait): auto tracks, leftover pushed into the gap. `fluid` (wide):
                // gap pinned, card absorbs the leftover so tracks span the container exactly.
                // Neither centres: a centred track group pulls the first column in and shoves a
                // partial last row into the middle of the page.
                rowMetrics.fit === 'spread' ? 'justify-between gap-6' : 'justify-start',
                'pt-2 pb-6 pl-5 pr-5' // Add inner margins to show shadows
              )}
              style={
                rowMetrics.fit === 'fluid'
                  ? {
                      // `minmax(0, …)` is required: a plain fixed track sets the grid's min-content
                      // to a full row, and Radix's `display: table` wrapper would then refuse to
                      // shrink below one row and overflow instead of dropping columns.
                      gridTemplateColumns: `repeat(${rowMetrics.columnCount}, minmax(0, ${rowMetrics.cardWidth}px))`,
                      columnGap: rowMetrics.columnGap
                    }
                  : { gridTemplateColumns: `repeat(auto-fill, ${rowMetrics.cardWidth}px)` }
              }
            >
              {sortedGames?.map((gameId, index) => (
                <div
                  key={`${gameId}_${nsfwFilterMode}`}
                  className={cn(
                    'flex-shrink-0' // Preventing compression
                  )}
                >
                  <LazyLoadComponent
                    threshold={300}
                    scrollPosition={scrollPosition}
                    placeholder={
                      <PlaceHolder shape={posterShape} cardWidth={rowMetrics.cardWidth} />
                    } // Necessary for scroll restoration
                  >
                    <GamePoster
                      gameId={gameId}
                      groupId={`collection:${collectionId}`}
                      shape={posterShape}
                      cardWidth={rowMetrics.cardWidth}
                      dragScenario={
                        by === 'custom' && nsfwFilterMode === NSFWFilterMode.All
                          ? 'reorder-games-in-collection'
                          : undefined
                      }
                      parentGap={rowMetrics.columnGap}
                      position={
                        (index % rowMetrics.columnCount === 0 && 'left') ||
                        (index % rowMetrics.columnCount === rowMetrics.columnCount - 1 &&
                          'right') ||
                        'center'
                      }
                    />
                  </LazyLoadComponent>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
        <ScrollToTopButton scrollAreaRef={scrollAreaRef} />
      </div>
    </DragContext.Provider>
  )
}

export const CollectionGames = trackWindowScroll(CollectionGamesComponent)
