import { useRef, useState } from 'react'
import { cn } from '~/utils'
import { Card, CardContent } from '~/components/ui/card'
import { ScrollArea } from '~/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '~/components/ui/table'
import { toast } from 'sonner'
import { useGameAdderStore } from './store'
import { Search } from './Search'
import { useTranslation } from 'react-i18next'

/**
 * Column widths in percent of the table, so they still adapt when the window is resized.
 * The name gets most of the room; a release date is always a short `YYYY-MM-DD`, and the
 * developer list is usually one name — both start narrow and can be dragged wider on demand.
 */
const DEFAULT_COLUMN_WIDTHS = [58, 16, 26]

/** Neither side of a dragged divider may collapse below this. */
const MIN_COLUMN_PERCENT = 8

export function GameList(): React.JSX.Element {
  const { t } = useTranslation('adder')
  const { setName, dataSourceId, setDataSourceId, gameList } = useGameAdderStore()
  const [columnWidths, setColumnWidths] = useState<number[]>(DEFAULT_COLUMN_WIDTHS)
  const tableRef = useRef<HTMLTableElement>(null)
  const resizeRef = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null)

  /**
   * Drag a column's right edge to resize it. Width is traded with the neighbouring column so the
   * total stays at 100% — otherwise widening one column would squeeze the rest unpredictably.
   */
  const startResize =
    (index: number) =>
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      resizeRef.current = { index, startX: event.clientX, startWidths: [...columnWidths] }
    }

  const moveResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = resizeRef.current
    const tableWidth = tableRef.current?.clientWidth ?? 0
    if (!state || tableWidth === 0) return

    const next = [...state.startWidths]
    const left = state.index
    const right = left + 1
    const requested = ((event.clientX - state.startX) / tableWidth) * 100
    const delta = Math.max(
      MIN_COLUMN_PERCENT - next[left],
      Math.min(next[right] - MIN_COLUMN_PERCENT, requested)
    )
    next[left] += delta
    next[right] -= delta
    setColumnWidths(next)
  }

  const endResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    resizeRef.current = null
  }

  /** The last column has no neighbour to trade with, so it just takes the remaining width. */
  const renderResizer = (index: number): React.JSX.Element => (
    <div
      role="separator"
      aria-orientation="vertical"
      title={t('gameAdder.gameList.resizeColumn')}
      className={cn(
        'absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize touch-none select-none',
        // Faint divider so the handle is discoverable, tinted on hover/drag to confirm it is live.
        'bg-border/70 transition-colors hover:bg-primary active:bg-primary'
      )}
      onPointerDown={startResize(index)}
      onPointerMove={moveResize}
      onPointerUp={endResize}
    />
  )

  return (
    <div className={cn('w-[60vw] h-[80vh] lg:h-[85vh] p-3')}>
      <div className={cn('flex flex-col w-full h-full gap-3')}>
        <Card className={cn('grow pt-3')}>
          <CardContent className="h-full w-full">
            <div className="w-full">
              <ScrollArea className={cn('h-[calc(80vh-230px)] lg:h-[calc(85vh-230px)] pr-3')}>
                <Table ref={tableRef} className={cn('table-fixed')}>
                  <colgroup>
                    {columnWidths.map((width, index) => (
                      <col key={index} style={{ width: `${width}%` }} />
                    ))}
                  </colgroup>
                  <TableHeader className={cn('')}>
                    <TableRow>
                      <TableHead className={cn('relative overflow-hidden')}>
                        {t('gameAdder.gameList.columns.name')}
                        {renderResizer(0)}
                      </TableHead>
                      <TableHead className={cn('relative overflow-hidden')}>
                        {t('gameAdder.gameList.columns.releaseDate')}
                        {renderResizer(1)}
                      </TableHead>
                      <TableHead className={cn('overflow-hidden')}>
                        {t('gameAdder.gameList.columns.developers')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gameList.map((game) => (
                      <TableRow
                        key={game.name}
                        onClick={() => {
                          setDataSourceId(game.id)
                          setName(game.name)
                          toast.success(t('gameAdder.gameList.selected', { name: game.name }))
                        }}
                        className={cn(
                          'cursor-pointer',
                          game.id === dataSourceId
                            ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground'
                            : ''
                        )}
                      >
                        <TableCell>
                          <div className={cn('truncate')} title={game.name}>
                            {game.name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={cn('truncate')} title={game.releaseDate}>
                            {game.releaseDate === ''
                              ? t('gameAdder.gameList.unknown')
                              : game.releaseDate}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={cn('truncate')} title={game.developers.join(', ')}>
                            {game.developers.join(', ') === ''
                              ? t('gameAdder.gameList.unknown')
                              : game.developers.join(', ')}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
        <Card className="p-0">
          <CardContent className="w-full h-full p-0">
            <Search className={cn('w-full p-6 py-5 text-sm')} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
