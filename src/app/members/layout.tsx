import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "All Members",
  description: "Browse the complete AMASI member directory. View all registered members of the Association of Minimal Access Surgeons of India with filtering and sorting.",
  alternates: { canonical: "/members" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
