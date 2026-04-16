"use client"

import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const reduced = useReducedMotion()
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={reduced ? { duration: 0.1 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
