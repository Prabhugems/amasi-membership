"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  BarChart3,
  Search,
  Menu,
  X,
  UserPlus,
  UserPen,
  CreditCard,
  LogIn,
  Award,
  ShieldCheck,
  FileSearch,
} from "lucide-react"
import { useState } from "react"

interface NavItem {
  name: string
  href: string
  icon: typeof LayoutDashboard
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
      { name: "All Members", href: "/members", icon: Users },
      { name: "Pending Actions", href: "/pending", icon: ClipboardCheck },
      { name: "Search Member", href: "/search", icon: Search },
      { name: "Reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Membership",
    items: [
      { name: "Apply", href: "/apply", icon: UserPlus },
      { name: "Track Status", href: "/apply/status", icon: FileSearch },
      { name: "Member Login", href: "/member", icon: LogIn },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-md bg-card border shadow-sm"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen w-64 border-r bg-card transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b px-6">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">A</span>
          </div>
          <div>
            <h1 className="font-semibold text-sm">AMASI</h1>
            <p className="text-xs text-muted-foreground">Membership Management</p>
          </div>
        </div>

        <nav className="flex flex-col gap-1 p-4 overflow-y-auto flex-1">
          {sections.map((section, idx) => (
            <div key={section.label}>
              {idx > 0 && <div className="my-2 border-t" />}
              <p className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                {section.label}
              </p>
              {section.items.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.name}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}
