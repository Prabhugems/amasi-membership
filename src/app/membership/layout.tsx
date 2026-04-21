import type { Metadata } from "next"
import { HelpButton } from "@/components/ui/help-button"

export const metadata: Metadata = {
  title: "Know Your Membership | AMASI",
  description: "Check your AMASI membership details by phone number, email, or AMASI number.",
  alternates: { canonical: "/membership" },
}

export default function MembershipLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-auto">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">A</span>
            </div>
            <div>
              <h1 className="font-semibold text-sm">AMASI</h1>
              <p className="text-[10px] text-muted-foreground">Know Your Membership</p>
            </div>
          </div>
          <a href="https://www.amasi.org" target="_blank" className="text-xs text-muted-foreground hover:text-foreground">www.amasi.org</a>
        </div>
        {children}
      </div>
      <HelpButton />
    </div>
  )
}
