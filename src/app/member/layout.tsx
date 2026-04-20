import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Member Portal",
  description: "Access your AMASI member dashboard. View your membership details, download certificates, update your profile, and manage your account in one place.",
  alternates: { canonical: "/member" },
}

export default function MemberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Member pages use their own full-screen layout
  // Sidebar is rendered inside the page component after login
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-auto">
      {children}
    </div>
  )
}
