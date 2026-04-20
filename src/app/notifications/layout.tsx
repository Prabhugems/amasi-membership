import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Notifications",
  description: "Send and manage bulk notifications to AMASI members. Create targeted announcements, email campaigns, and important updates for the membership community.",
  alternates: { canonical: "/notifications" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
