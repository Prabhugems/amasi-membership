import Link from "next/link"
import { ArrowRight, FileText } from "lucide-react"
import { MOU_EVENTS, MOU_EVENT_TYPES } from "@/lib/mou-events"

const STEPS = [
  {
    title: "Sign in with your member email",
    text: "A one-time code is sent to the email registered with AMASI. Only bonafide members can apply.",
  },
  {
    title: "Fill in the online application",
    text: "Event details, venue, supporting associations and the consent letters the MOU asks for. No letterhead or courier needed.",
  },
  {
    title: "AMASI decides",
    text: "The Executive Committee considers every event except AMASICON, which goes to the General Body Meeting. HQ processes complete applications within two weeks.",
  },
  {
    title: "MOU issued and signed",
    text: "On approval HQ sends the MOU signed by the Hon. Secretary. Sign every page and return one copy — the event is sanctioned once HQ receives it.",
  },
]

export default function MouIndexPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Academic events</p>
        <h1 className="text-2xl font-bold tracking-tight mt-1">Apply to host an AMASI event</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Choose the event you would like to organise. Each application is reviewed by AMASI HQ
          under the corresponding Memorandum of Understanding.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {MOU_EVENT_TYPES.map((slug) => {
          const ev = MOU_EVENTS[slug]
          return (
            <Link
              key={slug}
              href={`/mou/${slug}`}
              className="group rounded-md border bg-card p-6 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{ev.eyebrow}</p>
              <h2 className="mt-1 text-base font-bold tracking-tight">{ev.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{ev.description}</p>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Decided by {ev.decidedBy === "gbm" ? "General Body" : "Executive Committee"}
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-primary">
                  Apply <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">How it works</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The online form replaces the downloadable application letter.
          </p>
        </div>
        <ol className="md:col-span-2 rounded-md border bg-card divide-y">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4 p-5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-muted text-xs font-medium">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">Draft MOUs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Read the clauses before you apply. Course MOUs are issued by HQ on approval.
          </p>
        </div>
        <ul className="md:col-span-2 rounded-md border bg-card divide-y">
          {MOU_EVENT_TYPES.filter((s) => MOU_EVENTS[s].mouUrl).map((slug) => {
            const ev = MOU_EVENTS[slug]
            return (
              <li key={slug} className="flex items-center justify-between gap-4 p-4">
                <span className="flex items-center gap-3 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  MOU for {ev.shortName}
                </span>
                <a
                  href={ev.mouUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Open PDF
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
