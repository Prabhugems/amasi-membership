"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/providers/sidebar-provider"
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  BarChart3,
  Search,
  Menu,
  X,
  UserPlus,
  FileSearch,
  Ticket,
  Headphones,
  LogIn,
  ChevronsLeft,
  ExternalLink,
  LogOut,
  ArrowUpCircle,
  Bell,
  Send,
  Shield,
  ScrollText,
  Clock,
  KeyRound,
  TrendingDown,
  Award,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { useAdminRole } from "@/hooks/use-admin-role"

interface NavItem {
  name: string
  href: string
  icon: typeof LayoutDashboard
  badgeKey?: "pending" | "tickets" | "upgrades" | "incomplete"
  superAdminOnly?: boolean
}

interface NavSection {
  label: string
  items: NavItem[]
}

const sections: NavSection[] = [
  {
    label: "Admin",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Pending Actions", href: "/pending", icon: ClipboardCheck, badgeKey: "pending" },
      { name: "Incomplete Applications", href: "/incomplete", icon: Clock, badgeKey: "incomplete" },
      { name: "All Members", href: "/members", icon: Users },
      { name: "Search Member", href: "/search", icon: Search },
      { name: "Reports", href: "/reports", icon: BarChart3 },
      { name: "Funnel", href: "/funnel", icon: TrendingDown },
      { name: "Upgrades", href: "/upgrades", icon: ArrowUpCircle, badgeKey: "upgrades" as const },
      { name: "FMAS Holders", href: "/admin/fmas", icon: Award },
      { name: "Support Tickets", href: "/tickets", icon: Ticket, badgeKey: "tickets" },
      { name: "Notifications", href: "/notifications", icon: Bell },
      { name: "Campaigns", href: "/campaigns", icon: Send },
      { name: "Activity Log", href: "/audit", icon: ScrollText },
      { name: "Admin Users", href: "/admin", icon: Shield, superAdminOnly: true },
      { name: "API Keys", href: "/admin/api-keys", icon: KeyRound, superAdminOnly: true },
    ],
  },
  {
    label: "Membership",
    items: [
      { name: "Apply", href: "/apply", icon: UserPlus },
      { name: "Track Status", href: "/apply/status", icon: FileSearch },
      { name: "Know Your Membership", href: "/membership", icon: Search },
      { name: "Member Directory", href: "/directory", icon: Users },
      { name: "Member Login", href: "/member", icon: LogIn },
      { name: "Support", href: "/support", icon: Headphones },
    ],
  },
]

function useBadgeCounts(enabled: boolean) {
  const [counts, setCounts] = useState<{ pending: number; tickets: number; upgrades: number; incomplete: number }>({
    pending: 0,
    tickets: 0,
    upgrades: 0,
    incomplete: 0,
  })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function fetchCounts() {
      try {
        const res = await fetch("/api/badges")
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setCounts({
          pending: data.pending ?? 0,
          tickets: data.tickets ?? 0,
          upgrades: data.upgrades ?? 0,
          incomplete: data.incomplete ?? 0,
        })
      } catch {
        // silently fail — badges just show 0
      }
    }

    fetchCounts()
    const interval = setInterval(fetchCounts, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [enabled])

  return counts
}

export function Sidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { collapsed, toggle } = useSidebar()
  const router = useRouter()
  const adminRole = useAdminRole()
  const isSuperAdmin = adminRole === "super_admin"
  const counts = useBadgeCounts(adminRole !== null)
  const reduced = useReducedMotion()
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)")
    const onChange = () => setIsDesktop(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  // Mobile is always 256px (lg:w-16 / w-64 original behavior). On desktop, width
  // animates between 64 (collapsed) and 256 (expanded).
  const width = isDesktop ? (collapsed ? 64 : 256) : 256
  const widthTransition = reduced
    ? { duration: 0 }
    : { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const }
  const labelTransition = reduced ? { duration: 0 } : { duration: 0.2 }

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
  }

  // Render only for authenticated admins. `null` here covers both "still
  // loading /api/auth/me" and "not an admin", so non-admin visitors never
  // see the admin sidebar (no info leak) and never flash it on first paint.
  if (adminRole === null) return null

  return (
    <>
      {/* Mobile menu button */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-md bg-card border shadow-sm"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        data-sidebar
        initial={false}
        animate={{ width }}
        transition={widthTransition}
        suppressHydrationWarning
        className={cn(
          "fixed left-0 top-0 z-40 h-screen border-r bg-card flex flex-col lg:translate-x-0 transition-transform duration-200 overflow-hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo / brand */}
        <div className="flex h-16 items-center gap-3 border-b px-4 shrink-0 relative">
          <button
            type="button"
            onClick={toggle}
            className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0 hover:bg-primary/90 transition-colors cursor-pointer"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span className="text-primary-foreground font-bold text-sm">A</span>
          </button>
          <AnimatePresence mode="wait" initial={false}>
            {!collapsed && (
              <motion.div
                key="brand"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={labelTransition}
                className="overflow-hidden whitespace-nowrap flex-1"
              >
                <span className="font-semibold text-sm leading-tight">AMASI</span>
                <p className="text-xs text-muted-foreground truncate">Membership Management</p>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Prominent expand/collapse toggle — visible in both states */}
          {!collapsed && (
            <button
              type="button"
              onClick={toggle}
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <motion.span animate={{ rotate: 0 }} transition={widthTransition} className="inline-flex">
                <ChevronsLeft className="h-4 w-4" />
              </motion.span>
            </button>
          )}
        </div>
        {/* When collapsed — show a floating expand chevron at the top of the nav */}
        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            className="absolute top-4 -right-3 z-10 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronsLeft className="h-3 w-3 rotate-180" />
          </button>
        )}

        {/* Navigation */}
        <nav className="flex flex-col gap-1 p-3 overflow-y-auto flex-1">
          {sections.map((section, idx) => (
            <div key={section.label}>
              {idx > 0 && <div className="my-3 border-t" />}
              <AnimatePresence mode="wait" initial={false}>
                {!collapsed && (
                  <motion.p
                    key={`section-${section.label}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={labelTransition}
                    className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider overflow-hidden whitespace-nowrap"
                  >
                    {section.label}
                  </motion.p>
                )}
              </AnimatePresence>
              {section.items.filter((item) => !item.superAdminOnly || isSuperAdmin).map((item) => {
                const isActive = pathname === item.href
                const badgeCount = item.badgeKey ? counts[item.badgeKey] : 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? item.name : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                      collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-slate-100/50 dark:hover:bg-slate-800/50 hover:text-accent-foreground"
                    )}
                  >
                    {/* Animated active-state glow bar */}
                    {isActive && (
                      <span className="sidebar-active-bar" aria-hidden="true" />
                    )}
                    <item.icon className="h-4 w-4 shrink-0" />
                    <AnimatePresence mode="wait" initial={false}>
                      {!collapsed && (
                        <motion.span
                          key={`label-${item.href}`}
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: "auto" }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={labelTransition}
                          className="overflow-hidden whitespace-nowrap flex-1 flex items-center gap-3"
                        >
                          <span className="truncate flex-1">{item.name}</span>
                          {badgeCount > 0 && (
                            <span className={cn(
                              "ml-auto text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5",
                              isActive
                                ? "bg-primary-foreground/20 text-primary-foreground"
                                : "bg-primary/10 text-primary"
                            )}>
                              {badgeCount > 99 ? "99+" : badgeCount}
                            </span>
                          )}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    {/* Badge dot in collapsed mode */}
                    {collapsed && badgeCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Logout + Footer */}
        <div className={cn("border-t px-4 py-3 shrink-0", collapsed && "px-2")}>
          {!collapsed ? (
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors mb-3"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Sign Out
            </button>
          ) : (
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors mb-3 mx-auto block"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
          {!collapsed ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">AMASI v1.0</p>
                <a
                  href="https://www.amasi.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
                >
                  www.amasi.org
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
              <button
                onClick={toggle}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <motion.span
                  animate={{ rotate: collapsed ? 180 : 0 }}
                  transition={widthTransition}
                  className="inline-flex"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </motion.span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={toggle}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <motion.span
                  animate={{ rotate: collapsed ? 180 : 0 }}
                  transition={widthTransition}
                  className="inline-flex"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </motion.span>
              </button>
            </div>
          )}
        </div>
      </motion.aside>
    </>
  )
}
