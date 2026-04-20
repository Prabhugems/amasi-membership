import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Support Tickets",
  description: "Manage AMASI support tickets. View, assign, and resolve member inquiries and issues with a streamlined ticket management system for administrators.",
  alternates: { canonical: "/tickets" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
