"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <div style={{ padding: "40px", textAlign: "center", fontFamily: "Arial, sans-serif" }}>
          <h2>Something went wrong</h2>
          <p style={{ color: "#666" }}>An unexpected error occurred. Our team has been notified.</p>
          <button
            onClick={reset}
            style={{ marginTop: "20px", padding: "10px 24px", background: "#0f766e", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px" }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  )
}
