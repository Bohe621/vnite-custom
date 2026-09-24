import type { PosterShape } from '@appTypes/models'
import { cn } from '~/utils'
import { getShowcasePosterCardWidth, getShowcasePosterItemHeight } from '../posterGridMetrics'

export function PlaceHolder({
  shape = 'portrait',
  cardWidth
}: {
  shape?: PosterShape
  /**
   * Must mirror the width the wall actually renders. Reserved space that disagrees with the
   * real card makes the scroll position jump as soon as the lazy-loaded content swaps in.
   */
  cardWidth?: number
}): React.JSX.Element {
  const width = cardWidth ?? getShowcasePosterCardWidth(shape)

  return (
    <div
      className={cn('cursor-pointer object-cover bg-transparent')}
      style={{
        width,
        height: getShowcasePosterItemHeight(shape, width)
      }}
    ></div>
  )
}
