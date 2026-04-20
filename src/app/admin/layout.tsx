import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Admin Users",
  description: "Manage AMASI administrator accounts and permissions. Add, edit, or remove admin users and configure role-based access control for the membership system.",
  alternates: { canonical: "/admin" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
