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
