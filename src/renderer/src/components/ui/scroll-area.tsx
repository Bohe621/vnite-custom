import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '~/utils'

function ScrollArea({
  className,
  children,
  scrollRestorationId,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /**
   * Stable identity for the router's scroll restoration.
   *
   * TanStack Router keys scroll offsets by an absolute `nth-child` path from `<html>`, which
   * silently stops matching when the DOM shape changes — a Radix modal's scroll lock inserts a
   * first `<body>` child, pushing `#root` out of position so old paths stop resolving and the
   * page comes back at the top. Passing this makes the router key the viewport by
   * `[data-scroll-restoration-id]` instead, which survives the shift.
   */
  scrollRestorationId?: string
}): React.JSX.Element {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        data-scroll-restoration-id={scrollRestorationId}
        className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color_box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>): React.JSX.Element {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none z-20',
        orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2 flex-col border-t border-t-transparent',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border/[var(--scrollbar-opacity)] backdrop-blur-[var(--scrollbar-blur)] hover:bg-primary/[var(--scrollbar-opacity)] relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
