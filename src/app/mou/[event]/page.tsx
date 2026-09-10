import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { MOU_EVENT_TYPES, getMouEvent } from "@/lib/mou-events"
import { MouApplicationForm } from "./mou-application-form"

type Params = { params: Promise<{ event: string }> }

export function generateStaticParams() {
  return MOU_EVENT_TYPES.map((event) => ({ event }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { event } = await params
  const config = getMouEvent(event)
  if (!config) return { title: "Not found" }
  return {
    title: `Host ${config.shortName}`,
    description: config.description,
    alternates: { canonical: `/mou/${config.slug}` },
  }
}

export default async function MouEventPage({ params }: Params) {
  const { event } = await params
  const config = getMouEvent(event)
  if (!config) notFound()
  return <MouApplicationForm eventType={config.slug} />
}
