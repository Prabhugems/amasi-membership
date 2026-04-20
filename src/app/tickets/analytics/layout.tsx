import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Ticket Analytics",
  description: "Analyze AMASI support ticket metrics and trends. Track response times, resolution rates, ticket volume, and team performance with detailed dashboards.",
  alternates: { canonical: "/tickets/analytics" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
