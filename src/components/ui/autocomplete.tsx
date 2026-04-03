"use client"

import { useState, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"

interface AutocompleteProps {
  value: string
  onChange: (value: string) => void
  options: { label: string; sublabel?: string }[]
  placeholder?: string
  className?: string
  maxResults?: number
}

export function Autocomplete({ value, onChange, options, placeholder, className, maxResults = 8 }: AutocompleteProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const query = open ? search : ""
  const filtered = query.length >= 2
    ? options.filter(o =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        (o.sublabel && o.sublabel.toLowerCase().includes(query.toLowerCase()))
      ).slice(0, maxResults)
    : []

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div className={`relative ${open ? "z-[60]" : ""}`}>
      <Input
        ref={inputRef}
        value={open ? search : value}
        onChange={(e) => {
          setSearch(e.target.value)
          if (!open) setOpen(true)
          // Also update the actual value for custom entries
          onChange(e.target.value)
        }}
        onFocus={() => {
          setOpen(true)
          setSearch(value)
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div ref={listRef} className="absolute z-50 mt-1 w-full max-h-[200px] overflow-y-auto rounded-md border bg-popover shadow-lg">
          {filtered.map((opt, i) => (
            <button
              key={i}
              type="button"
              className={`w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors ${
                opt.label === value ? "bg-accent/50 font-medium" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(opt.label)
                setSearch(opt.label)
                setOpen(false)
              }}
            >
              <div>{opt.label}</div>
              {opt.sublabel && <div className="text-xs text-muted-foreground">{opt.sublabel}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
