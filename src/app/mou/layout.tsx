import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Host an AMASI Academic Event",
  description:
    "Apply online to host AMASICON, a workshop / CME / conference, a rural surgery camp, or an FMAS, MMAS, NextGen or SLCP course under the AMASI banner.",
  alternates: { canonical: "/mou" },
}

export default function MouLayout({ children }: { children: React.ReactNode }) {
  return children
}
