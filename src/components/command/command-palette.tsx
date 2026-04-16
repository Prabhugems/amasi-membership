"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Command } from "cmdk"
import {
  LayoutDashboard,
  Users,
  Clock as ClockIcon,
  ShieldCheck,
  BarChart3,
  Headphones,
  Bell,
  Search,
  ArrowRight,
  Sparkles,
  UserPlus,
  ScrollText,
  Award,
  type LucideIcon,
} from "lucide-react"

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

type MemberResult = {
  id: string
  name: string
  membership_no: string
  email?: string
  membership_type?: string
}

type NavItem = {
  group: string
  label: string
  href: string
  icon: LucideIcon
  shortcut?: string
}

const NAV_ITEMS: NavItem[] = [
  { group: "Navigate", label: "Dashboard", href: "/", icon: LayoutDashboard, shortcut: "G D" },
  { group: "Navigate", label: "All Members", href: "/members", icon: Users, shortcut: "G M" },
  { group: "Navigate", label: "Pending Applications", href: "/pending", icon: ClockIcon, shortcut: "G P" },
  { group: "Navigate", label: "Upgrade Requests", href: "/upgrades", icon: UserPlus },
  { group: "Navigate", label: "Reports", href: "/reports", icon: BarChart3, shortcut: "G R" },
  { group: "Navigate", label: "Support Tickets", href: "/tickets", icon: Headphones, shortcut: "G T" },
  { group: "Navigate", label: "Notifications", href: "/notifications", icon: Bell },
  { group: "Navigate", label: "Activity Log", href: "/audit", icon: ScrollText },
  { group: "Navigate", label: "Admin Users", href: "/admin", icon: ShieldCheck },
  { group: "Navigate", label: "Member Search", href: "/search", icon: Search },
  { group: "Navigate", label: "Verify Member", href: "/verify", icon: ShieldCheck },
  { group: "Navigate", label: "Digital Card", href: "/card", icon: Award },
  { group: "Actions", label: "Apply for Membership", href: "/apply", icon: Sparkles },
]

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [memberResults, setMemberResults] = useState<MemberResult[]>([])
  const [searching, setSearching] = useState(false)

  // Reset query whenever the palette closes so next open starts fresh
  useEffect(() => {
    if (!open) {
      setQuery("")
      setMemberResults([])
      setSearching(false)
    }
  }, [open])

  // Debounced member search
  useEffect(() => {
    if (!open) return
    if (!query || query.length < 2) {
      setMemberResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    const controller = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/members/search?q=${encodeURIComponent(query)}&limit=5`,
          { signal: controller.signal }
        )
        const json = await res.json()
        if (cancelled) return
        setMemberResults(Array.isArray(json?.data) ? json.data : [])
      } catch {
        if (cancelled) return
        setMemberResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
      controller.abort()
    }
  }, [query, open])

  if (!open) return null

  const go = (href: string) => {
    router.push(href)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-label="Command Palette"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-[620px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/70 dark:border-slate-800/70 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Command Palette" shouldFilter>
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search for pages, members, or actions..."
            className="w-full px-5 py-4 text-base bg-transparent outline-none border-b border-slate-200 dark:border-slate-800 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100"
          />
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {searching ? "Searching..." : "No matches"}
            </Command.Empty>

            <Command.Group
              heading="Navigate"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-400 dark:[&_[cmdk-group-heading]]:text-slate-500"
            >
              {NAV_ITEMS.filter((i) => i.group === "Navigate").map((item) => {
                const Icon = item.icon
                return (
                  <Command.Item
                    key={item.href}
                    value={`${item.label} ${item.href}`}
                    onSelect={() => go(item.href)}
                    className="group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer text-slate-900 dark:text-slate-100 data-[selected=true]:bg-emerald-50 data-[selected=true]:text-emerald-900 dark:data-[selected=true]:bg-emerald-500/15 dark:data-[selected=true]:text-emerald-300 transition"
                  >
                    <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400 group-data-[selected=true]:text-emerald-600" />
                    <span className="flex-1">{item.label}</span>
                    {item.shortcut && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                        {item.shortcut}
                      </span>
                    )}
                  </Command.Item>
                )
              })}
            </Command.Group>

            <Command.Group
              heading="Actions"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-400 dark:[&_[cmdk-group-heading]]:text-slate-500"
            >
              {NAV_ITEMS.filter((i) => i.group === "Actions").map((item) => {
                const Icon = item.icon
                return (
                  <Command.Item
                    key={item.href}
                    value={`${item.label} ${item.href}`}
                    onSelect={() => go(item.href)}
                    className="group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer text-slate-900 dark:text-slate-100 data-[selected=true]:bg-emerald-50 data-[selected=true]:text-emerald-900 dark:data-[selected=true]:bg-emerald-500/15 dark:data-[selected=true]:text-emerald-300 transition"
                  >
                    <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400 group-data-[selected=true]:text-emerald-600" />
                    <span className="flex-1">{item.label}</span>
                  </Command.Item>
                )
              })}
            </Command.Group>

            {memberResults.length > 0 && (
              <Command.Group
                heading="Members"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-400 dark:[&_[cmdk-group-heading]]:text-slate-500"
              >
                {memberResults.map((m) => {
                  const initials = m.name
                    .split(" ")
                    .map((s) => s[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()
                  return (
                    <Command.Item
                      key={m.id}
                      value={`member-${m.id} ${m.name} ${m.membership_no} ${m.email ?? ""}`}
                      onSelect={() => go(`/card?amasi=${encodeURIComponent(m.membership_no)}`)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer text-slate-900 dark:text-slate-100 data-[selected=true]:bg-emerald-50 data-[selected=true]:text-emerald-900 dark:data-[selected=true]:bg-emerald-500/15 dark:data-[selected=true]:text-emerald-300 transition"
                    >
                      <div className="h-7 w-7 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 text-[10px] font-semibold flex items-center justify-center shrink-0">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {m.membership_no}
                          {m.email ? ` · ${m.email}` : ""}
                        </p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}
          </Command.List>

          <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-2 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">esc</kbd>
              close
            </span>
            <span className="ml-auto">AMASI Admin</span>
          </div>
        </Command>
      </div>
    </div>
  )
}
