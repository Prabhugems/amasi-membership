import { Card, CardContent } from "@/components/ui/card"
import { type LucideIcon, TrendingUp, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatCardProps {
  title: string
  value: string | number
  description?: string
  icon: LucideIcon
  trend?: { value: string; positive: boolean }
  iconClassName?: string
  gradient?: string
  sparklineData?: number[]
}

function Sparkline({ data, color = "currentColor" }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 80
  const h = 28
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 4) - 2
      return `${x},${y}`
    })
    .join(" ")

  return (
    <svg width={w} height={h} className="opacity-40" viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  iconClassName,
  gradient,
  sparklineData,
}: StatCardProps) {
  return (
    <Card className={cn("relative overflow-hidden border-0 shadow-sm", gradient)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 flex-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold tracking-tight">{value}</p>
            <div className="flex items-center gap-2">
              {trend && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-semibold",
                    trend.positive ? "text-emerald-600" : "text-red-500"
                  )}
                >
                  {trend.positive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {trend.value}
                </span>
              )}
              {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                iconClassName || "bg-primary/10 text-primary"
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            {sparklineData && (
              <Sparkline data={sparklineData} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
