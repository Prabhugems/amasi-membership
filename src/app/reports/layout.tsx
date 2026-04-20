import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Reports & Analytics",
  description: "View AMASI membership reports and analytics. Access insights on membership growth, application trends, revenue data, and organizational performance metrics.",
  alternates: { canonical: "/reports" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
