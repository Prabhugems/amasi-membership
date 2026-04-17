"use client"

import { CheckCircle } from "lucide-react"
import type { Ticket, Reply } from "./types"

const STEPS = [
  { status: "open", label: "Ticket Created", description: "Your ticket has been received" },
  { status: "in_progress", label: "In Progress", description: "Our team is working on it" },
  { status: "resolved", label: "Resolved", description: "Issue has been resolved" },
  { status: "closed", label: "Closed", description: "Ticket is closed" },
]

const STATUS_ORDER = ["open", "in_progress", "resolved", "closed"]

interface StatusTimelineProps {
  ticket: Ticket
  replies?: Reply[]
}

export function StatusTimeline({ ticket }: StatusTimelineProps) {
  const currentIdx = STATUS_ORDER.indexOf(ticket.status)

  return (
    <div className="py-3 px-1">
      <div
        className="flex items-center justify-between relative"
        role="list"
        aria-label="Ticket progress"
      >
        {/* Progress bar background */}
        <div className="absolute top-4 left-6 right-6 h-0.5 bg-muted" />
        {/* Progress bar filled */}
        <div
          className="absolute top-4 left-6 h-0.5 bg-primary transition-all duration-500"
          style={{ width: `calc(${(currentIdx / (STEPS.length - 1)) * 100}% - 48px)` }}
        />
        {STEPS.map((step, idx) => {
          const isCompleted = idx < currentIdx
          const isCurrent = idx === currentIdx
          const isActive = idx <= currentIdx
          return (
            <div
              key={step.status}
              className="flex flex-col items-center z-10 flex-1"
              role="listitem"
              aria-current={isCurrent ? "step" : undefined}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  isCurrent
                    ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                    : isCompleted
                      ? "bg-primary/80 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isActive ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              <p className={`text-[10px] mt-1.5 font-medium text-center hidden sm:block ${
                isCurrent ? "text-primary" : isActive ? "text-foreground" : "text-muted-foreground"
              }`}>
                {step.label}
              </p>
              {/* Mobile: shorter labels */}
              <p className={`text-[9px] mt-1 font-medium text-center sm:hidden ${
                isCurrent ? "text-primary" : isActive ? "text-foreground" : "text-muted-foreground"
              }`}>
                {step.label.split(" ")[0]}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
