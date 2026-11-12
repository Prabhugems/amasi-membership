"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h2 className="text-xl font-bold tracking-tight">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This page could not be displayed. Please reload. If it keeps happening, try Chrome or Safari
          and contact support.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          <a href="/apply" className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium">
            Back to Apply
          </a>
        </div>
      </div>
    </div>
  )
}
