import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Track Application Status",
  description: "Track your AMASI membership application status in real time. Check whether your application is under review, approved, or requires additional information.",
  alternates: { canonical: "/apply/status" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
