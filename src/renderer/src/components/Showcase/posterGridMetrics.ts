import type { PosterShape } from '@appTypes/models'

/**
 * Poster geometry for the showcase walls (home page + collection detail).
 *
 * `wide` base width is 300, not the 310px ceiling that three columns allow at the default
 * (980px content area) window: the headroom keeps the wall at three columns when the window
 * shrinks by a few dozen pixels instead of snapping back to two.
 */
export const SHOWCASE_POSTER_CARD_WIDTH_BY_SHAPE: Record<PosterShape, number> = {
  portrait: 148,
  wide: 300
}

/** Cover aspect ratio (width / height) per shape: portrait 2:3, wide 3:2. */
export const SHOWCASE_POSTER_ASPECT_BY_SHAPE: Record<PosterShape, number> = {
  portrait: 2 / 3,
  wide: 3 / 2
}

/** Height of the one-line (truncated) game name below the image, plus its 8px gap. */
export const SHOWCASE_POSTER_TITLE_BLOCK_HEIGHT = 24

/**
 * Image-frame height (no title block) at the shape's base width.
 *
 * The 最近游戏 row mixes a `wide` card with `portrait` ones; the two shapes have different
 * base widths *and* aspects, so their frame bottoms don't line up (200px vs 222px).
 * `BigGamePoster` reads this to scale the `wide` card's width up (333px) so it matches the
 * portrait card's 222px height. The inverse is `getShowcasePosterFrameWidthForHeight`.
 */
export function getShowcasePosterFrameHeight(shape: PosterShape): number {
  return getShowcasePosterCardWidth(shape) / getShowcasePosterAspect(shape)
}

/**
 * The width a poster of `shape` needs in order to render exactly `height` px tall, keeping
 * its aspect ratio. Used by the 最近游戏 row to line the `wide` card's bottom edge up with
 * the `portrait` cards beside it.
 */
export function getShowcasePosterFrameWidthForHeight(shape: PosterShape, height: number): number {
  return height * getShowcasePosterAspect(shape)
}

export const SHOWCASE_POSTER_MIN_COLUMN_GAP = 24
export const SHOWCASE_POSTER_ROW_GAP = 40

/**
 * Tailwind width classes for the poster cards.
 *
 * Tailwind only emits classes that appear literally in the source, so the class strings
 * cannot be derived from the numbers above at runtime. They live here, next to the numeric
 * widths, to keep the two representations in one place — when you change a width above,
 * change the matching class here too.
 */
export const SHOWCASE_POSTER_WIDTH_CLASS_BY_SHAPE: Record<PosterShape, string> = {
  portrait: 'w-[148px]',
  wide: 'w-[300px]'
}

/**
 * How a wall absorbs the horizontal slack left over by a row.
 *
 * - `spread` (portrait): the card keeps its base width and the leftover is pushed into the
 *   column gap, so the gap climbs from the minimum up toward a full card width as the window
 *   widens, then snaps back when an extra column fits (a sawtooth).
 * - `fluid` (wide): the gap is pinned to the minimum and the card absorbs the leftover, so a
 *   full row spans the content width exactly and no gap ever exceeds the minimum.
 *
 * A fluid card is deliberately uncapped: its width is already self-limiting within one column
 * band (it climbs back down to base width as the next column fits), so a cap would only break
 * left-edge alignment without buying anything.
 */
export const SHOWCASE_POSTER_ROW_FIT_BY_SHAPE: Record<PosterShape, 'spread' | 'fluid'> = {
  portrait: 'spread',
  wide: 'fluid'
}

/** Portrait card width, kept for callers that do not care about the shape. */
export const SHOWCASE_POSTER_CARD_WIDTH = SHOWCASE_POSTER_CARD_WIDTH_BY_SHAPE.portrait

export interface ShowcasePosterRowMetrics {
  /** Which slack-absorption rule applies to this shape. */
  fit: 'spread' | 'fluid'
  /** How many cards fit in one row at this content width. */
  columnCount: number
  /** Rendered card width in px (fractional in fluid mode). */
  cardWidth: number
  /** Space between two neighbouring cards in a row, in px. */
  columnGap: number
}

export function getShowcasePosterCardWidth(shape: PosterShape): number {
  return SHOWCASE_POSTER_CARD_WIDTH_BY_SHAPE[shape] ?? SHOWCASE_POSTER_CARD_WIDTH
}

export function getShowcasePosterWidthClass(shape: PosterShape): string {
  return (
    SHOWCASE_POSTER_WIDTH_CLASS_BY_SHAPE[shape] ?? SHOWCASE_POSTER_WIDTH_CLASS_BY_SHAPE.portrait
  )
}

export function getShowcasePosterAspect(shape: PosterShape): number {
  return SHOWCASE_POSTER_ASPECT_BY_SHAPE[shape] ?? SHOWCASE_POSTER_ASPECT_BY_SHAPE.portrait
}

export function getShowcasePosterRowFit(shape: PosterShape): 'spread' | 'fluid' {
  return SHOWCASE_POSTER_ROW_FIT_BY_SHAPE[shape] ?? SHOWCASE_POSTER_ROW_FIT_BY_SHAPE.portrait
}

/**
 * Total card height (image + single-line title block). The row height of the virtualized
 * "all games" wall depends on this, so it must follow the actual rendered card width.
 */
export function getShowcasePosterItemHeight(shape: PosterShape, cardWidth: number): number {
  return cardWidth / getShowcasePosterAspect(shape) + SHOWCASE_POSTER_TITLE_BLOCK_HEIGHT
}

/**
 * Resolve how a wall lays out one row at the given content width. Both the virtualized
 * "all games" wall and the collection grid read their numbers from here, so they can never
 * disagree about column count, card width or gap.
 *
 * Callers lay rows out from the left, so a `fluid` full row spans the content width exactly
 * and the only row with slack to place is the final partial one — it must start at the left
 * content edge, not the middle of the container.
 */
export function getShowcasePosterRowMetrics(
  shape: PosterShape,
  contentWidth: number
): ShowcasePosterRowMetrics {
  const baseWidth = getShowcasePosterCardWidth(shape)
  const gap = SHOWCASE_POSTER_MIN_COLUMN_GAP
  const fit = getShowcasePosterRowFit(shape)

  if (contentWidth <= 0) {
    return { fit, columnCount: 1, cardWidth: baseWidth, columnGap: gap }
  }

  const columnCount = Math.max(1, Math.floor((contentWidth + gap) / (baseWidth + gap)))

  if (fit !== 'fluid') {
    // `spread`: keep the card at its base width and hand the leftover to the gap, which is
    // exactly what `justify-between` / `justify-content: space-between` does in the DOM.
    const columnGap =
      columnCount > 1 ? (contentWidth - columnCount * baseWidth) / (columnCount - 1) : gap

    return { fit, columnCount, cardWidth: baseWidth, columnGap }
  }

  // `fluid`: the card takes the whole leftover, so the row is flush with both content edges.
  // Truncate rather than round: a sub-pixel overshoot would make the row wider than its
  // container and provoke a horizontal scrollbar.
  const cardWidth = Math.floor(((contentWidth - (columnCount - 1) * gap) / columnCount) * 100) / 100

  return { fit, columnCount, cardWidth, columnGap: gap }
}
