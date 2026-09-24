import React, { ImgHTMLAttributes, useEffect, useLayoutEffect, useRef, useState } from 'react'
import smartcrop from 'smartcrop'
import { useAttachmentStore } from '~/stores'
import { cn } from '~/utils'

/**
 * Whether the browser can paint `el` immediately without a visible decode.
 *
 * `complete` alone is not enough: it also flips to true for an image that already failed
 * (`naturalWidth === 0`), and a `<img>` that finished decoding *before* React attached its
 * `onLoad` handler never emits the event again. Checking `naturalWidth` plus `decode()` in a
 * layout effect covers both.
 */
function isImagePaintable(el: HTMLImageElement): boolean {
  return el.complete === true && el.naturalWidth > 0
}

function isImageBroken(el: HTMLImageElement): boolean {
  return el.complete === true && el.naturalWidth === 0
}

/**
 * Below this rendered width, a `cover` crop is decided by plain geometry instead of the
 * pixel-level search.
 *
 * `smartcrop` is a synchronous pixel search (~3ms `getImageData` + scoring per image). A cold
 * scroll of the 127-game list measured 74 calls / 112ms, with one 64ms long task — about four
 * dropped frames, the exact "portrait mode scrolls badly" stutter. At thumbnail size the smart
 * answer is nearly always "take the middle", so the payoff doesn't exist: the 119x179
 * library-bar card skips it, while the 300px showcase cards and detail-page heroes stay above
 * the threshold and keep the real crop.
 */
const SMART_CROP_MIN_WIDTH_PX = 200

/**
 * Geometry for the smartcrop `objectPosition`.
 *
 * The meaning of `objectPosition` is: the point at (u%, v%) in the source image aligns with the
 * point at (u%, v%) in the display container. The calculation below is therefore based on:
 *   crop.x + crop.width  * u = img.naturalWidth  * u
 *   crop.y + crop.height * v = img.naturalHeight * v
 *
 * Returns `null` when there is nothing worth overriding: no usable geometry yet (zero client box
 * or broken image), when the aspect ratios already match closely, or when the rendered box is
 * too small for a pixel-level crop to be visible.
 */
async function computeSmartCropPosition(img: HTMLImageElement): Promise<string | null> {
  const clientWidth = img.clientWidth
  const clientHeight = img.clientHeight

  if (clientWidth <= 0 || clientHeight <= 0 || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return null
  }

  // Small thumbnails: keep the cheap centred crop, skip the pixel search entirely.
  if (clientWidth < SMART_CROP_MIN_WIDTH_PX) {
    return null
  }

  const clientRatio = clientWidth / clientHeight
  const imgRatio = img.naturalWidth / img.naturalHeight

  // Symmetric metric for aspect ratio difference:
  // - swapping imgRatio and clientRatio does not change the value
  // - swapping width and height of either ratio (transpose) also preserves the value
  const ratioDiff = Math.abs(Math.log(imgRatio / clientRatio))

  // Use smartcrop when the cropped portion exceeds roughly 22% relative to the visible area
  // Computed as: exp(ratioDiff) - 1
  if (ratioDiff <= 0.2) {
    return null
  }

  const result = await smartcrop.crop(img, { width: clientWidth, height: clientHeight })
  const crop = result.topCrop

  let u = (crop.x / (img.naturalWidth - crop.width)) * 100
  let v = (crop.y / (img.naturalHeight - crop.height)) * 100
  u = u >= 0 && u <= 100 ? u : 50
  v = v >= 0 && v <= 100 ? v : 50

  return `${u}% ${v}%`
}

interface GameImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  gameId: string
  type: 'background' | 'cover' | 'icon' | 'logo' | string
  onUpdated?: () => void
  fallback?: React.ReactNode
  fit?: 'cover' | 'contain'
  forceSmartCrop?: boolean
  shadow?: boolean
  flips?: boolean
  blur?: boolean
  blurType?: 'bigposter' | 'poster' | 'smallposter'
  initialMask?: boolean
}

export const GameImage: React.FC<GameImageProps> = ({
  gameId,
  type,
  className,
  onError,
  onUpdated,
  fallback = <div>No Pictures</div>,
  fit = 'cover',
  forceSmartCrop = false,
  shadow = false,
  flips = false,
  blur = false,
  blurType = 'poster',
  initialMask = false,
  ...imgProps
}) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const { getAttachmentInfo, setAttachmentError } = useAttachmentStore()
  const maskRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [objectPosition, setObjectPosition] = useState('center')
  // `true` once the image has been seen painted at least once on this node. Kept in a ref (not
  // state) so it can be read and written inside the layout effect without causing a re-render.
  const hasPaintedRef = useRef(false)
  // Mirrors `objectPosition` for the layout effect's first paint, which runs before any state
  // update can take effect. `undefined` until smartcrop has produced a result.
  const objectPositionRef = useRef<string | undefined>(undefined)

  const attachmentInfo = getAttachmentInfo('game', gameId, `images/${type}.webp`)

  const blurClassMap: Record<'bigposter' | 'poster' | 'smallposter', string> = {
    bigposter: 'filter blur-[36px]',
    poster: 'filter blur-[24px]',
    smallposter: 'filter blur-[8px]'
  }

  // If the image is known to have an error, return fallback directly
  const attachmentUrl = `attachment://game/${gameId}/images/${type}.webp?t=${
    attachmentInfo?.timestamp
  }`

  // Reset the per-node paint bookkeeping when the image identity actually changes, so a
  // different picture is never shown with the previous one's crop. Declared before the
  // early `error` return so the hook order stays stable across renders.
  useEffect(() => {
    hasPaintedRef.current = false
    objectPositionRef.current = undefined
  }, [attachmentUrl])

  // Paint on the first frame (no placeholder, no smartcrop pop) whenever the browser can supply
  // the pixels synchronously. On a virtualized wall, `attachment://` is disk-cached so a remount
  // has no network round trip — but the `<img>` still has to decode, which read as "reloaded".
  //
  // Resolved before paint:
  //   (1) loaded before React attached `onLoad` -> the event never fires, so we mark it painted;
  //   (2) `objectPosition` already known for this element -> reuse it and skip the crop;
  //   (3) `complete && naturalWidth > 0` -> pixels are available, show them now.
  //
  // The timestamp-bearing `src` is deliberately *not* a cache key: `?t=` only changes when the
  // attachment is replaced, and keying on it would resurrect a stale crop after a media edit
  // instead of letting `onLoad` recompute.
  useLayoutEffect(() => {
    const img = imgRef.current
    if (!img) return

    // (1) & (3) Already decodable -> no mask, no fade, and remember it for the next mount.
    if (isImagePaintable(img)) {
      hasPaintedRef.current = true
      if (!isLoaded) setIsLoaded(true)
    } else if (isImageBroken(img) && !isLoaded) {
      // Let the broken-image branch take over instead of falling through as "still loading".
      setIsLoaded(true)
    }

    // (2) Same element as a previous mount -> apply the known crop without re-running smartcrop.
    // This is what keeps the poster from visibly shifting on the frame after a remount.
    const knownPosition = objectPositionRef.current
    if (knownPosition !== undefined && img.style.objectPosition !== knownPosition) {
      img.style.objectPosition = knownPosition
    }
  }, [isLoaded])

  if (attachmentInfo?.error) {
    return <>{fallback}</>
  }

  const clearMaskOverlay = (): void => {
    if (maskRef.current) {
      setTimeout(() => {
        if (maskRef.current) {
          maskRef.current.style.display = 'none'
        }
      }, 300)
    }
  }

  const smartCrop = async (): Promise<void> => {
    const img = imgRef.current
    if (img && fit === 'cover' && (forceSmartCrop || type === 'cover')) {
      // bigPoster in recent games also need smart crop
      try {
        await img.decode?.()

        const computed = await computeSmartCropPosition(img)

        // Only publish a result once the geometry is real. A detached or zero-sized image
        // (`clientWidth === 0`) cannot be cropped meaningfully, and committing its value would
        // bake a bogus `objectPosition` into the ref that the next first paint then reuses.
        if (computed) {
          objectPositionRef.current = computed
          setObjectPosition(computed)
        }
      } catch (err) {
        console.error('smartcrop error:', err)
      }
    }
  }

  /**
   * Run the crop when the browser is idle instead of right after `load`. `onLoad` fires mid-scroll,
   * and the crop is a synchronous pixel search — running it inline piles that work into the frame
   * that's already mounting a row, so the stutter lands on the scroll. Deferring to idle keeps it
   * out of scroll frames; the poster just holds its centred crop for a few extra (invisible) ms.
   * (Chromium has `requestIdleCallback`; the `setTimeout` fallback covers anything else.)
   */
  const scheduleSmartCrop = (): void => {
    const run = (): void => {
      void smartCrop()
    }

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 400 })
      return
    }

    setTimeout(run, 0)
  }

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* Placeholder only covers the case where nothing could be painted on the first frame.
          Once the node has been seen painted, re-showing it is never given a placeholder again. */}
      {!isLoaded && !hasPaintedRef.current && (
        <div className={cn('absolute inset-0 ', className?.includes('rounded') && 'rounded-lg')} />
      )}

      <img
        ref={imgRef}
        src={attachmentUrl}
        className={cn(
          'transition-opacity duration-300',
          shadow && 'shadow-md shadow-black/50',
          flips && '-scale-y-100',
          blur && blurClassMap[blurType],
          className
        )}
        style={{
          objectFit: fit,
          objectPosition
        }}
        onLoad={() => {
          hasPaintedRef.current = true
          setIsLoaded(true)
          scheduleSmartCrop()
          onUpdated?.()
          clearMaskOverlay()
        }}
        onError={(e) => {
          setAttachmentError('game', gameId, `images/${type}.webp`, true)
          setIsLoaded(false)
          onError?.(e)
          clearMaskOverlay()
        }}
        {...imgProps}
      />

      {/*
        Mask Overlay
        -----------------
        Purpose:
          - Prevent NSFW image flash before the image fully loads (usually occurs on the initial program load)

        Notes:
          - Must not depend on any React state or conditional rendering as initial DOM must exist to cover the image
          - Use `maskRef` to control visibility or fade-out after load
          - Only used for the initial mask; not applied continuously for NSFW
            because hover/scale animation may expose edges that cannot be fully blurred
      */}
      {initialMask && (
        <div
          ref={maskRef}
          className={cn('absolute inset-0 bg-transparent backdrop-blur-2xl pointer-events-none')}
        />
      )}
    </div>
  )
}
