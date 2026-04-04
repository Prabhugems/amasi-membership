"use client"

import { usePathname } from "next/navigation"
import { useSidebar } from "@/components/providers/sidebar-provider"

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { collapsed } = useSidebar()

  const publicRoutes = ["/apply", "/member", "/verify", "/support", "/card", "/login"]
  const isPublicPage = publicRoutes.some(r => pathname.startsWith(r))

  if (isPublicPage) {
    return <div>{children}</div>
  }

  return (
    <div
      className="transition-sidebar"
      style={{ paddingLeft: undefined }}
    >
      {/* On mobile: no padding. On lg+: sidebar width */}
      <div className={collapsed ? "lg:pl-16" : "lg:pl-64"} style={{ transition: "padding-left 0.2s ease" }}>
        {children}
      </div>
    </div>
  )
}
