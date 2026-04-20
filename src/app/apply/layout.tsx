import type { Metadata } from "next"
import { HelpButton } from "@/components/ui/help-button"

export const metadata: Metadata = {
  title: "Apply for Membership",
  description: "Apply for AMASI membership online. Submit your credentials, upload documents, and begin your journey with the Association of Minimal Access Surgeons of India.",
  alternates: { canonical: "/apply" },
}

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-auto">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">A</span>
            </div>
            <div>
              <h1 className="font-semibold text-sm">AMASI</h1>
              <p className="text-[10px] text-muted-foreground">Membership Application</p>
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
