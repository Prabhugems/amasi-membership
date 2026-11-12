"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

/**
 * Route fade-in. Deliberately CSS-only: content is visible by default and the
 * animation only starts *from* a lower opacity. If JS fails, the browser skips
 * animations (some in-app WebViews do), or hydration is slow, the page is still
 * readable. The previous framer-motion version rendered `opacity: 0` in the SSR
 * HTML and relied on client JS to reveal it, which left the screen blank on
 * some phones/browsers.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  )
}
