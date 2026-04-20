import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Support Center",
  description: "Get help with your AMASI membership. Browse FAQs, submit support tickets, and contact the membership team for assistance with applications or accounts.",
  alternates: { canonical: "/support" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
