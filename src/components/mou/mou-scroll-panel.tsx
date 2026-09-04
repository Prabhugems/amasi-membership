"use client"

import { useCallback } from "react"
import { CheckCircle2 } from "lucide-react"

// Pure and exported for testing — a real <div>'s scroll metrics satisfy
// this shape, but no DOM/jsdom is needed to test the threshold math
// (this codebase has no component-testing setup — see the plan doc's
// Global Constraints).
export function isScrolledToEnd(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  thresholdPx = 8
): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - thresholdPx
}

export function MouScrollPanel({
  clauses,
  title,
  scrolledToEnd,
  onScrolledToEnd,
}: {
  clauses: string[]
  title: string
  scrolledToEnd: boolean
  onScrolledToEnd: () => void
}) {
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!scrolledToEnd && isScrolledToEnd(e.currentTarget)) onScrolledToEnd()
    },
    [scrolledToEnd, onScrolledToEnd]
  )

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</p>
      <div
        onScroll={handleScroll}
        className="max-h-72 overflow-y-auto rounded-md border border-border bg-muted/20 p-4 text-sm space-y-3"
      >
        {clauses.map((clause, i) => (
          <p key={i}>
            <span className="font-semibold mr-1">{i + 1}.</span>
            {clause}
          </p>
        ))}
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        {scrolledToEnd ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            You&apos;ve read the full MOU text.
          </>
        ) : (
          "Scroll to the end to enable acceptance below."
        )}
      </p>
    </div>
  )
}
