import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Activity Log",
  description: "Review the AMASI system activity log and audit trail. Track all administrative actions, membership changes, and system events for compliance and security.",
  alternates: { canonical: "/audit" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
