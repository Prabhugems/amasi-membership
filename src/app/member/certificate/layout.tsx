import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Membership Certificate",
  description: "Download your official AMASI membership certificate. Access and save your verified digital certificate from the Association of Minimal Access Surgeons of India.",
  alternates: { canonical: "/member/certificate" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
