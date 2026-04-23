import type { JSX } from "react"
import Link from "next/link"
import { CreditCard, ArrowRight } from "lucide-react"

interface PaymentOnHoldStripProps {
  count: number
}

export function PaymentOnHoldStrip({ count }: PaymentOnHoldStripProps): JSX.Element | null {
  if (count === 0) return null

  const s = count

  return (
    <Link
      href="/incomplete?status=payment_on_hold"
      className="flex items-center justify-between gap-4 rounded-2xl border border-red-300/80 bg-gradient-to-r from-red-50 via-rose-50/80 to-red-50/60 px-5 py-4 shadow-[0_1px_2px_rgba(239,68,68,0.12),0_0_0_1px_rgba(239,68,68,0.10)] transition dark:bg-red-500/10 dark:border-red-400/30"
      role="alert"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 bg-red-100 dark:bg-red-400/20">
          <CreditCard className="h-4 w-4 text-red-600 dark:text-red-300" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-900 dark:text-red-100">
            {count} payment{s !== 1 ? "s" : ""} on hold — money captured, no application submitted
          </p>
          <p className="text-xs mt-0.5 text-red-700 dark:text-red-300">
            Refund or resume the applicant&apos;s submission before reconciliation
          </p>
        </div>
      </div>
      <div className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-sm transition shrink-0 bg-red-900/90 hover:bg-red-900">
        Resolve now
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
    </Link>
  )
}
