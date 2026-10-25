import type { Metadata } from "next"

// The link is the credential: keep it out of search results, link previews and referrer logs.
export const metadata: Metadata = {
  title: "Survey participant details",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}

export default function SurveyLayout({ children }: { children: React.ReactNode }) {
  return children
}
