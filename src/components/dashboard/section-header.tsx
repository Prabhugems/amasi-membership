import type { LucideIcon } from "lucide-react"
import type { ReactNode, JSX } from "react"
import { cn } from "@/lib/utils"

export type SectionAccent =
  | "emerald"
  | "blue"
  | "amber"
  | "violet"
  | "rose"
  | "sky"
  | "teal"

export interface SectionHeaderProps {
  title: string
  subtitle?: string
  icon: LucideIcon
  accent?: SectionAccent
  children?: ReactNode
  className?: string
}

const ACCENT_CLASSES: Record<SectionAccent, string> = {
  emerald: "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm shadow-emerald-500/20",
  teal: "bg-gradient-to-br from-teal-400 to-teal-600 text-white shadow-sm shadow-teal-500/20",
  blue: "bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-sm shadow-blue-500/20",
  sky: "bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-sm shadow-sky-500/20",
  amber: "bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-sm shadow-amber-500/20",
  violet: "bg-gradient-to-br from-violet-400 to-violet-600 text-white shadow-sm shadow-violet-500/20",
  rose: "bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-sm shadow-rose-500/20",
}

export function SectionHeader({
  title,
  subtitle,
  icon: Icon,
  accent = "emerald",
  children,
  className,
}: SectionHeaderProps): JSX.Element {
  return (
    <div
      className={cn("flex items-center justify-between gap-4", className)}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            "h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
            ACCENT_CLASSES[accent],
          )}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}
