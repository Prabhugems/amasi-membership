import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Resubmit Application",
  description: "Edit and resubmit your AMASI membership application. Update your details, attach revised documents, and resubmit for review by the membership committee.",
  alternates: { canonical: "/apply/resubmit" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
