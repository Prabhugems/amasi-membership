import type { Metadata } from "next"
import { HelpButton } from "@/components/ui/help-button"

export const metadata: Metadata = {
  title: "Member Directory | AMASI",
  description: "Search and find AMASI members by name, city, state, zone, or speciality.",
  alternates: { canonical: "/directory" },
}

export default function DirectoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">A</span>
            </div>
            <div>
              <h1 className="font-semibold text-sm">AMASI</h1>
              <p className="text-[10px] text-muted-foreground">Member Directory</p>
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
