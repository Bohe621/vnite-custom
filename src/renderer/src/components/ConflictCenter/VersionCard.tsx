import type { VersionReviewSummary } from '@appTypes/utils'
import { useTranslation } from 'react-i18next'
import { Badge } from '~/components/ui/badge'
import { GameImage } from '~/components/ui/game-image'
import { cn } from '~/utils'

/**
 * Poster card for one game that needs its versions sorted out.
 *
 * Sized and shaped like the library wall (`SHOWCASE_POSTER_CARD_WIDTH` / 2:3 cover) so the
 * workbench reads as "the same library, filtered down to the broken entries".
 */
export function VersionCard({
  review,
  onSelect
}: {
  review: VersionReviewSummary
  onSelect: (gameId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation('adder')

  // Every entry past the first is a duplicate, and every waiting folder is one decision.
  const duplicateCount = Math.max(0, review.entryCount - 1)
  // Of those, the ones with no directory left on disk: nothing to keep, only an entry to merge
  // away. They are counted apart from the duplicates that still hold a folder, which are the ones
  // that need a real decision about which copy survives. Clamped so the two always add up.
  const staleCount = Math.min(Math.max(0, review.staleEntryCount), duplicateCount)
  const liveDuplicateCount = duplicateCount - staleCount
  const problemCount = duplicateCount + review.incomingCount

  return (
    <button
      type="button"
      onClick={() => onSelect(review.gameId)}
      className={cn(
        'group flex w-[148px] shrink-0 cursor-pointer flex-col gap-2 text-left',
        'non-draggable'
      )}
    >
      <div
        className={cn(
          'relative w-[148px] rounded-lg transition-shadow',
          'group-hover:ring-2 group-hover:ring-primary'
        )}
      >
        <GameImage
          gameId={review.gameId}
          type="cover"
          fit="cover"
          draggable="false"
          className={cn('w-[148px] aspect-[2/3] rounded-lg')}
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <span className="icon-[mdi--image-off-outline] h-8 w-8 text-muted-foreground" />
            </div>
          }
        />
        {problemCount > 0 && (
          <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-medium leading-5 text-white">
            {problemCount > 99 ? '99+' : problemCount}
          </span>
        )}
      </div>

      <div className={cn('flex flex-col gap-1')}>
        <div className={cn('truncate text-sm')} title={review.title}>
          {review.title}
        </div>
        <div className={cn('flex flex-wrap gap-1')}>
          {liveDuplicateCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {t('versionConflict.reason.duplicates', { entries: liveDuplicateCount })}
            </Badge>
          )}
          {staleCount > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {t('versionConflict.reason.stale', { folders: staleCount })}
            </Badge>
          )}
          {review.incomingCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {t('versionConflict.reason.incoming', { folders: review.incomingCount })}
            </Badge>
          )}
        </div>
        <div className={cn('text-[11px] text-muted-foreground')}>
          {t('versionConflict.reason.versionCount', { versions: review.versionCount })}
        </div>
      </div>
    </button>
  )
}
