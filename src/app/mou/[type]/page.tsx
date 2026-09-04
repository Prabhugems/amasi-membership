import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { ApplicationForm } from "@/components/mou/application-form"

// Plain dynamic segment read via the route param — no useSearchParams /
// usePathname / useRouter here, so per AGENTS.md's build-check-rules this
// does not force client-side rendering and needs no <Suspense> wrapper.
// This file itself has no "use client" directive; ApplicationForm below is
// the client component that owns all interactivity.
export default async function MouApplicationTypePage({
  params,
}: {
  params: Promise<{ type: string }>
}) {
  const { type } = await params
  const typeConfig = getEventTypeConfig(type)
  if (!typeConfig) notFound()

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <Link
          href="/mou"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All event types
        </Link>

        <div className="mt-4 mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Application</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{typeConfig.label}</h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{typeConfig.description}</p>
        </div>

        <ApplicationForm typeId={typeConfig.id} />
      </div>
    </div>
  )
}
