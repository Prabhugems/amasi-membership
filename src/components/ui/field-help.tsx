"use client"

import { useState } from "react"
import { HelpCircle } from "lucide-react"

export function FieldHelp({ text }: { text: string }) {
  const [show, setShow] = useState(false)

  return (
    <span className="relative inline-block ml-1">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="text-muted-foreground hover:text-foreground"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 bg-popover border rounded-md shadow-lg text-xs text-muted-foreground">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 bg-popover border-r border-b rotate-45" />
        </div>
      )}
    </span>
  )
}
