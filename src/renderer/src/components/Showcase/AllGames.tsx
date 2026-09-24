import {
  observeElementOffset,
  useVirtualizer,
  type Range,
  type Virtualizer
} from '@tanstack/react-virtual'
import { SeparatorDashed } from '@ui/separator-dashed'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GameNavCM } from '~/components/contextMenu/GameNavCM'
import { AddCollectionDialog } from '~/components/dialog/AddCollectionDialog'
import { PlayTimeEditorDialog } from '~/components/Game/Config/ManageMenu/PlayTimeEditorDialog'
import { GamePropertiesDialog } from '~/components/Game/Config/Properties'
import { InformationDialog } from '~/components/Game/Overview/Information/InformationDialog'
import { CalculateStorageSizeDialog } from '~/components/Game/Overview/Record/CalculateStorageSizeDialog'
import { BatchGameNavCM } from '~/components/GameBatchEditor/BatchGameNavCM'
import { useGameBatchEditorStore } from '~/components/GameBatchEditor/store'
import { Button } from '~/components/ui/button'
import { ContextMenu, ContextMenuTrigger } from '~/components/ui/context-menu'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '~/components/ui/select'
import { useConfigState } from '~/hooks'
import { sortGames, useVisibleGameIds } from '~/stores/game'
import { cn } from '~/utils'
import {
  getShowcasePosterItemHeight,
  getShowcasePosterRowMetrics,
  SHOWCASE_POSTER_ROW_GAP
} from './posterGridMetrics'
import { GamePoster } from './posters/GamePoster'

function getScrollViewport(element: HTMLElement | null): HTMLDivElement | null {
  const viewport = element?.closest('[data-slot="scroll-area-viewport"]')
  return viewport instanceof HTMLDivElement ? viewport : null
}

function chunkGamesByRow(gameIds: string[], columnCount: number): string[][] {
  const rows: string[][] = []

  for (let index = 0; index < gameIds.length; index += columnCount) {
    rows.push(gameIds.slice(index, index + columnCount))
  }

  return rows
}

/**
 * Extra rows kept mounted above and below the visible range.
 *
 * The built-in `overscan` is too thin here: a newly mounted row at the band edge still has to
 * decode its `<img>` (bytes are on disk, decode isn't). Two extra rows each side push that
 * boundary off screen, so the image decodes before it scrolls into view. Items are keyed by
 * row index, so a wider band costs dormant DOM, not re-renders.
 */
const SHOWCASE_ROW_OVERSCAN = 2

/**
 * Widen the default overscan band by `SHOWCASE_ROW_OVERSCAN` rows on each side.
 *
 * Reproduces `defaultRangeExtractor` and extends it, rather than adding to its result, because
 * this function is memoized on its own identity: a closure created during render would change
 * the option on every render and force the virtualizer to recompute its indexes for nothing.
 */
const extractAllGamesRows = ({ startIndex, endIndex, overscan, count }: Range): number[] => {
  const start = Math.max(startIndex - overscan - SHOWCASE_ROW_OVERSCAN, 0)
  const end = Math.min(endIndex + overscan + SHOWCASE_ROW_OVERSCAN, count - 1)
  const length = Math.max(end - start + 1, 0)
  const indexes = new Array<number>(length)

  for (let offset = 0; offset < length; offset++) {
    indexes[offset] = start + offset
  }

  return indexes
}

// TanStack Router restores the viewport scroll position asynchronously (after its commit), so
// on the frame this observer attaches the scrollTop may still read 0 even though a restore is
// pending. Seeding the virtualizer with that 0 renders the *top* rows for a frame; the restore
// then jumps scrollTop, the range recomputes, and every poster remounts — the "showcase images
// reload when coming back from a game page" bug. So: if a non-zero restore for this element is
// pending, do *not* seed eagerly; let the real restore drive the first range instead.
//
// Pending is detected by reading TanStack Router's sessionStorage scroll cache, shaped
// `{ [routeKey]: { [cssSelector]: { scrollX, scrollY } } }` (see router-core `scroll-restoration.js`).
// The key string is asserted, not derived: the module exports `storageKey`/`restoreScroll` but
// not the literal key. Every access is guarded (this runs during render commit; a throw would
// take the wall down), and any parse/shape surprise falls back to `false` (eager seeding).
const TANSTACK_SCROLL_STORAGE_KEY = 'tsr-scroll-restoration-v1_3'

function hasPendingRestoration(element: HTMLElement): boolean {
  try {
    const raw = window.sessionStorage?.getItem(TANSTACK_SCROLL_STORAGE_KEY)
    if (!raw) return false

    const byKey: unknown = JSON.parse(raw)
    if (typeof byKey !== 'object' || byKey === null) return false

    for (const entries of Object.values(byKey as Record<string, unknown>)) {
      if (typeof entries !== 'object' || entries === null) continue

      for (const [selector, entry] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) continue

        const { scrollY } = entry as { scrollY?: unknown }
        // A cached 0 cannot be told apart from "nothing to restore", and seeding 0 is already
        // what this function does by default — so only a non-zero row is worth waiting for.
        if (typeof scrollY !== 'number' || scrollY === 0) continue

        if (element.matches(selector)) return true
      }
    }
  } catch {
    // Malformed cache, unavailable storage, or an invalid selector — behave as if nothing
    // is pending and let the caller seed the offset eagerly.
  }

  return false
}

function observeScrollViewportOffset(
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
  cb: (offset: number, isScrolling: boolean) => void
): void | (() => void) {
  const element = instance.scrollElement

  if (element) {
    const offset = instance.options.horizontal
      ? element.scrollLeft * ((instance.options.isRtl && -1) || 1)
      : element.scrollTop

    if (offset !== 0 || !hasPendingRestoration(element)) {
      cb(offset, false)
    }
  }

  return observeElementOffset(instance, cb)
}

export function AllGames(): React.JSX.Element {
  const [by, setBy] = useConfigState('game.showcase.sort.by')
  const [order, setOrder] = useConfigState('game.showcase.sort.order')
  // Poster shape for the showcase walls: `portrait` (2:3) or `wide` (3:2)
  const [posterShape] = useConfigState('game.showcase.posterShape')
  const visibleGameIds = useVisibleGameIds()
  const games = sortGames(by, order, visibleGameIds)
  const toggleOrder = (): void => {
    setOrder(order === 'asc' ? 'desc' : 'asc')
  }
  const { t } = useTranslation('game')

  const [gridLayoutState, setGridLayoutState] = useState<{
    contentWidth: number
    scrollMargin: number
  }>({
    contentWidth: 0,
    scrollMargin: 0
  })
  const [scrollViewport, setScrollViewport] = useState<HTMLDivElement | null>(null)
  const [contextMenuGameId, setContextMenuGameId] = useState<string | null>(null)
  const [isAddCollectionDialogOpen, setIsAddCollectionDialogOpen] = useState(false)
  const [isPlayTimeEditorDialogOpen, setIsPlayTimeEditorDialogOpen] = useState(false)
  const [isInformationDialogOpen, setIsInformationDialogOpen] = useState(false)
  const [isPropertiesDialogOpen, setIsPropertiesDialogOpen] = useState(false)
  const [isStorageSizeDialogOpen, setIsStorageSizeDialogOpen] = useState(false)
  const isBatchMode = useGameBatchEditorStore((state) => state.isBatchMode)
  const measureFrameRef = useRef<number | null>(null)
  const pendingContextMenuGameIdRef = useRef<string | null>(null)
  const gridOuterRef = useRef<HTMLDivElement>(null)
  const rowsHostRef = useRef<HTMLDivElement>(null)
  const measureGridRef = useRef<() => void>(() => {})

  // Column count, card width and gap for the current content width. The wide shape is
  // `fluid`: its gap stays pinned at the minimum and the card absorbs the leftover instead
  // of the gap, so a row can never end up with a 347px void between two posters.
  const rowMetrics = useMemo(
    () => getShowcasePosterRowMetrics(posterShape, gridLayoutState.contentWidth),
    [posterShape, gridLayoutState.contentWidth]
  )
  const columnCount = rowMetrics.columnCount
  const posterCardWidth = rowMetrics.cardWidth
  // The card height follows its width (3:2 for wide, 2:3 for portrait, plus the one-line
  // title block), so the virtualized row height has to be recomputed with the width.
  const posterItemHeight = getShowcasePosterItemHeight(posterShape, posterCardWidth)
  const rows = useMemo(() => chunkGamesByRow(games, columnCount), [columnCount, games])
  const rowCount = rows.length

  // `directDomUpdates`: let the virtualizer write each row's `translateY` (and the host height)
  // straight to the DOM instead of through React. Without it, every scroll tick re-renders the
  // whole mounted band; with it, `onChange` only re-renders when the range/scrolling state
  // actually changes. Measured on the portrait wall: a scroll step was median 15.2ms / p95
  // 33.6ms, 28 of 60 steps over a frame, from ~130 posters mounting across the sweep. See
  // `.workbuddy/docs/Vnite-开发速查.md`.
  //
  // Contract this now relies on (react-virtual docs): rows are `position: absolute` at
  // `top:0;left:0`, must *not* set their own main-axis position (hence no `translateY` on the
  // row), and the host takes `containerRef` without setting `height` itself. It stays a
  // constant `true` (not a prop): toggling at runtime leaves stale inline styles.
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rowCount,
    estimateSize: () => posterItemHeight,
    gap: SHOWCASE_POSTER_ROW_GAP,
    getScrollElement: () => scrollViewport,
    observeElementOffset: observeScrollViewportOffset,
    rangeExtractor: extractAllGamesRows,
    overscan: 3,
    scrollMargin: gridLayoutState.scrollMargin,
    directDomUpdates: true,
    useFlushSync: false
  })

  measureGridRef.current = () => {
    const gridOuter = gridOuterRef.current
    const rowsHost = rowsHostRef.current

    if (!scrollViewport || !gridOuter || !rowsHost) {
      return
    }

    const gridStyle = window.getComputedStyle(gridOuter)
    const paddingLeft = parseFloat(gridStyle.paddingLeft) || 0
    const paddingRight = parseFloat(gridStyle.paddingRight) || 0
    const contentWidth = Math.max(0, gridOuter.clientWidth - paddingLeft - paddingRight)
    const rowsHostRect = rowsHost.getBoundingClientRect()
    const ancestorTop = scrollViewport.getBoundingClientRect().top
    const nextState = {
      contentWidth,
      scrollMargin: scrollViewport.scrollTop + (rowsHostRect.top - ancestorTop)
    }

    setGridLayoutState((prevState) => {
      if (
        prevState.contentWidth === nextState.contentWidth &&
        prevState.scrollMargin === nextState.scrollMargin
      ) {
        return prevState
      }

      return nextState
    })
  }

  // Resolve the outer scroll viewport once, then remeasure when container geometry changes.
  useLayoutEffect(() => {
    const gridOuter = gridOuterRef.current
    if (!gridOuter) return

    const scrollViewport = getScrollViewport(gridOuter)
    if (!scrollViewport) return
    setScrollViewport(scrollViewport)

    const scheduleMeasure = (): void => {
      if (measureFrameRef.current !== null) {
        cancelAnimationFrame(measureFrameRef.current)
      }

      measureFrameRef.current = requestAnimationFrame(() => {
        measureFrameRef.current = null
        measureGridRef.current()
      })
    }

    scheduleMeasure()
    const resizeObserver = new ResizeObserver(() => scheduleMeasure())
    resizeObserver.observe(gridOuter)
    resizeObserver.observe(scrollViewport)

    return (): void => {
      resizeObserver.disconnect()

      if (measureFrameRef.current !== null) {
        cancelAnimationFrame(measureFrameRef.current)
        measureFrameRef.current = null
      }
    }
  }, [])

  // After row/column structure changes, remeasure on the next frame to refresh layout offsets.
  // `posterItemHeight` is part of the trigger because the fluid card width (and therefore the
  // row height) changes continuously while the window is resized, and the virtualizer caches
  // the size it estimated until it is explicitly told to re-measure.
  useLayoutEffect(() => {
    rowVirtualizer.measure()
    const frame = requestAnimationFrame(() => measureGridRef.current())

    return (): void => cancelAnimationFrame(frame)
  }, [columnCount, rowCount, posterItemHeight])

  const virtualRows = rowVirtualizer.getVirtualItems()

  // The shared trigger covers the whole grid area, so only allow the native
  // contextmenu event to reach Radix when a poster cell captured a game id.
  // Gap/blank-space right clicks are swallowed here instead of opening a menu.
  const handleGridContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!pendingContextMenuGameIdRef.current) {
      event.preventDefault()
    }
  }

  return (
    <div className={cn('w-full flex flex-col gap-1')}>
      <div className={cn('flex flex-row items-center gap-5 justify-center px-5')}>
        <div className={cn('flex flex-row gap-5 items-center justify-center')}>
          <div className={cn('text-accent-foreground select-none flex-shrink-0')}>
            {t('showcase.sections.allGames')}
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
                  <SelectItem value="record.score">
                    {t('showcase.sorting.options.score')}
                  </SelectItem>
                  <SelectItem value="record.storageSize">
                    {t('showcase.sorting.options.storageSize')}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {/* Toggle Order */}
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
        </div>

        <SeparatorDashed className="border-border" />
      </div>

      {/* Game List Container */}
      <div ref={gridOuterRef} className={cn('w-full pt-3 pl-5 pr-5 pb-6')}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={(node) => {
                rowsHostRef.current = node
                rowVirtualizer.containerRef(node)
              }}
              className={cn('w-full relative')}
              onContextMenuCapture={() => {
                pendingContextMenuGameIdRef.current = null
              }}
              onContextMenu={handleGridContextMenu}
            >
              {virtualRows.map((virtualRow) => {
                const rowGameIds = rows[virtualRow.index]
                if (!rowGameIds) return null

                const fillerCount = columnCount - rowGameIds.length

                return (
                  <div
                    key={virtualRow.key}
                    // Required for `directDomUpdates`: the virtualizer looks each row up in
                    // `elementsCache` by this attribute. Without it the cache stays empty and
                    // every row keeps its mounted position (all stacked at the top).
                    data-index={virtualRow.index}
                    className={cn('absolute left-0 top-0 w-full')}
                    // `height` only: with `directDomUpdates` the virtualizer owns this row's
                    // `transform`, so writing `translateY` here would fight the position it
                    // sets on the same frame and the row would stutter.
                    style={{ height: virtualRow.size }}
                    // A/B tested: removing this made no measurable difference to the scroll
                    // frame budget (max 41.4ms vs 39.8ms over an identical 372-frame wiggle),
                    // so its ResizeObserver is NOT a source of the residual jitter — kept
                    // because `directDomUpdates` needs it to populate `elementsCache`.
                    ref={rowVirtualizer.measureElement}
                  >
                    <div
                      className={cn(
                        'flex items-start',
                        // Both fits lay their rows out from the left. `spread` needs the
                        // fillers below to keep a partial last row at the same gap as a full
                        // one; `fluid` lets the card absorb the leftover instead, but it still
                        // must not centre — the row spans the full content width, so
                        // `justify-center` would push a two-card last row into the middle.
                        rowMetrics.fit === 'fluid' ? 'justify-start' : 'justify-between'
                      )}
                      style={
                        rowMetrics.fit === 'fluid'
                          ? { height: posterItemHeight, columnGap: rowMetrics.columnGap }
                          : { height: posterItemHeight }
                      }
                    >
                      {rowGameIds.map((gameId) => (
                        <div
                          key={gameId}
                          className={cn('flex-shrink-0')}
                          style={{ width: posterCardWidth }}
                          onContextMenuCapture={() => {
                            pendingContextMenuGameIdRef.current = gameId
                            setContextMenuGameId(gameId)
                          }}
                        >
                          <GamePoster
                            gameId={gameId}
                            disableContextMenu={true}
                            shape={posterShape}
                            cardWidth={posterCardWidth}
                          />
                        </div>
                      ))}
                      {/* Spacing filler: only `spread` rows need it, so that a partial last row
                          keeps the same gap as a full one. A `fluid` row has no gap to keep —
                          its cards are already sized to fill the row — so a partial last row
                          just ends early, exactly like the collection grid. */}
                      {rowMetrics.fit === 'spread' &&
                        Array.from({ length: fillerCount }, (_, fillerIndex) => (
                          <div
                            key={`all-games-row-${virtualRow.index}-filler-${fillerIndex}`}
                            className={cn('pointer-events-none flex-shrink-0')}
                            style={{ width: posterCardWidth }}
                          />
                        ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </ContextMenuTrigger>

          {isBatchMode ? (
            <BatchGameNavCM openAddCollectionDialog={() => setIsAddCollectionDialogOpen(true)} />
          ) : (
            contextMenuGameId && (
              <GameNavCM
                gameId={contextMenuGameId}
                openAddCollectionDialog={() => setIsAddCollectionDialogOpen(true)}
                openInformationEditorDialog={() => setIsInformationDialogOpen(true)}
                openPlayTimeEditorDialog={() => setIsPlayTimeEditorDialogOpen(true)}
                openStorageSizeEditorDialog={() => setIsStorageSizeDialogOpen(true)}
                openPropertiesDialog={() => setIsPropertiesDialogOpen(true)}
              />
            )
          )}
        </ContextMenu>
      </div>

      {contextMenuGameId && isAddCollectionDialogOpen && (
        <AddCollectionDialog
          gameIds={[contextMenuGameId]}
          setIsOpen={setIsAddCollectionDialogOpen}
        />
      )}
      {contextMenuGameId && isInformationDialogOpen && (
        <InformationDialog
          gameId={contextMenuGameId}
          isOpen={isInformationDialogOpen}
          setIsOpen={setIsInformationDialogOpen}
        />
      )}
      {contextMenuGameId && isPlayTimeEditorDialogOpen && (
        <PlayTimeEditorDialog
          gameId={contextMenuGameId}
          setIsOpen={setIsPlayTimeEditorDialogOpen}
        />
      )}
      {contextMenuGameId && isPropertiesDialogOpen && (
        <GamePropertiesDialog
          gameId={contextMenuGameId}
          isOpen={isPropertiesDialogOpen}
          setIsOpen={setIsPropertiesDialogOpen}
        />
      )}
      {contextMenuGameId && isStorageSizeDialogOpen && (
        <CalculateStorageSizeDialog
          gameId={contextMenuGameId}
          isOpen={isStorageSizeDialogOpen}
          setIsOpen={setIsStorageSizeDialogOpen}
        />
      )}
    </div>
  )
}
