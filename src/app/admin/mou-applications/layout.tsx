import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Event MOU Applications",
  description: "Review member applications to host AMASI academic events and record signed MOUs.",
  alternates: { canonical: "/admin/mou-applications" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
