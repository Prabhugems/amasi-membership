"use client"

import { motion, useReducedMotion, type Variants } from "framer-motion"
import type { ReactNode } from "react"

export function StaggerContainer({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()
  const variants: Variants = {
    hidden: { opacity: 1 },
    show: {
      opacity: 1,
      transition: { staggerChildren: reduced ? 0 : 0.08, delayChildren: reduced ? 0 : 0.05 },
    },
  }
  return (
    <motion.div variants={variants} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()
  const variants: Variants = {
    hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { duration: reduced ? 0.15 : 0.4, ease: [0.22, 1, 0.36, 1] } },
  }
  return (
    <motion.div variants={variants} className={className}>{children}</motion.div>
  )
}
