import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Admin Login",
  description: "Sign in to the AMASI admin portal. Authorized administrators can manage memberships, review applications, and access administrative tools securely.",
  alternates: { canonical: "/login" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
