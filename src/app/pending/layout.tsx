import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Pending Applications",
  description: "Review pending AMASI membership applications. Evaluate submitted applications, verify credentials, and approve or request revisions from applicants.",
  alternates: { canonical: "/pending" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
