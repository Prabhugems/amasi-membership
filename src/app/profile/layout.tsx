import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "My Profile",
  description: "Manage your AMASI member profile. Update your personal information, contact details, qualifications, and membership preferences from your account.",
  alternates: { canonical: "/profile" },
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-auto">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">A</span>
          </div>
          <div>
            <h1 className="font-semibold text-sm">AMASI</h1>
            <p className="text-[10px] text-muted-foreground">Member Profile</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
