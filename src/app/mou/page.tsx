import Link from "next/link"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ArrowRight, FileText, Download, Info } from "lucide-react"
import { EVENT_TYPE_CONFIG } from "@/lib/mou/event-type-config"

// Static documents that intentionally stay outside the native-form system
// (Task 11 spec §"What to build" / design doc §1) — these are heavier
// legal/process documents downloaded and handled offline, not something an
// applicant fills in on this site.
const STATIC_DOCUMENTS: { label: string; href: string; kind: "docx" | "pdf" }[] = [
  { label: "Application for Hosting AMASICON", href: "https://amasi.org/wp-content/uploads/2025/06/Application-for-Hosting-AMASICON.docx", kind: "docx" },
  { label: "MOU for AMASICON", href: "https://amasi.org/wp-content/uploads/2025/06/MOU-for-AMASICON.pdf", kind: "pdf" },
  { label: "MOU for Workshop CME Conference", href: "https://amasi.org/wp-content/uploads/2025/06/MOU-for-Workshop-CME-Conference.pdf", kind: "pdf" },
  { label: "MOU for Rural Surgery Camp", href: "https://amasi.org/wp-content/uploads/2025/06/MOU-for-Rural-Surgery-Camp.pdf", kind: "pdf" },
  { label: "Process of Hosting AMASI Academic Event", href: "https://amasi.org/wp-content/uploads/2025/06/Process-of-Hosting-AMASI-Academic-Event.docx", kind: "docx" },
]

export default function MouLandingPage() {
  const eventTypes = Object.values(EVENT_TYPE_CONFIG)

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-10">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">AMASI Academic Events</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Apply to host an AMASI event</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground leading-relaxed">
            Choose the type of event you want to host. Each application goes through the Hon. Secretary
            for approval, and — where applicable — the zone chair and President are notified automatically.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {eventTypes.map((type) => (
            <Link key={type.id} href={`/mou/${type.id}`} className="group block">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardHeader>
                  <CardTitle className="text-base font-semibold flex items-start justify-between gap-2">
                    <span>{type.label}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </CardTitle>
                  <CardDescription className="leading-relaxed">{type.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>

        <div className="mt-14">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Reference documents</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">Static forms &amp; MOU templates</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground leading-relaxed">
            These documents are handled outside this application system.
          </p>

          <div className="mt-4 rounded-md border border-border bg-card p-4">
            <div className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                AMASICON hosting bids are decided separately by the Executive Committee and are not submitted
                through this form. Use the application document below to express interest.
              </p>
            </div>

            <ul className="mt-4 divide-y divide-border">
              {STATIC_DOCUMENTS.map((doc) => (
                <li key={doc.href}>
                  <a
                    href={doc.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 py-3 text-sm hover:text-primary"
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-foreground">{doc.label}</span>
                      <span className="text-xs uppercase text-muted-foreground">{doc.kind}</span>
                    </span>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
