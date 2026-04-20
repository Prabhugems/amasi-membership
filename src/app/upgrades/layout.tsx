import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Membership Upgrades",
  description: "Manage AMASI membership upgrade requests. Review and process member tier upgrades, track upgrade history, and handle membership category transitions.",
  alternates: { canonical: "/upgrades" },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
