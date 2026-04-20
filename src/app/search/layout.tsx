import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Search Members",
  description: "Search the AMASI member database. Find members by name, membership number, specialization, or location with advanced full-text search capabilities.",
  alternates: { canonical: "/search" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
