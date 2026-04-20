import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Feedback",
  description: "Share your feedback about the AMASI membership portal. Help us improve our services by providing suggestions, reporting issues, or rating your experience.",
  alternates: { canonical: "/support/feedback" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
