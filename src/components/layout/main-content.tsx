"use client"

import { useSidebar } from "@/components/providers/sidebar-provider"
import { useAdminRole } from "@/hooks/use-admin-role"

export function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar()
  const adminRole = useAdminRole()

  // Padding-left reserves space for the fixed Sidebar. The Sidebar only
  // renders for authenticated admins, so reserve space only when adminRole
  // is set. Non-admin visitors get no left padding (no blank gap on
  // /directory, /membership, etc.).
  if (adminRole === null) {
    return <div>{children}</div>
  }

  return (
    <div className="transition-sidebar">
      <div className={collapsed ? "lg:pl-16" : "lg:pl-64"} style={{ transition: "padding-left 0.2s ease" }}>
        {children}
      </div>
    </div>
  )
}
