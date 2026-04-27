import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Track Application — AMASI",
  description:
    "Check your AMASI membership application status. See your review timeline, payment confirmation, and next steps — no admin help needed.",
  alternates: { canonical: "/track" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
