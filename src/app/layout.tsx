import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { QueryProvider } from "@/components/providers/query-provider"
import { SidebarProvider } from "@/components/providers/sidebar-provider"
import { MainContent } from "@/components/layout/main-content"
import { Toaster } from "sonner"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "AMASI — Membership Management System",
    template: "%s | AMASI",
  },
  description:
    "Association of Minimal Access Surgeons of India — Membership application, tracking, and management system.",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "AMASI — Membership Management System",
    description:
      "Association of Minimal Access Surgeons of India — Membership application, tracking, and management system.",
    siteName: "AMASI",
    type: "website",
    locale: "en_IN",
  },
  metadataBase: new URL("https://membership.amasi.org"),
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-background">
        <QueryProvider>
          <SidebarProvider>
            <Sidebar />
            <MainContent>
              <Header />
              <main className="p-6">{children}</main>
            </MainContent>
          </SidebarProvider>
          <Toaster position="top-right" />
        </QueryProvider>
        <script
          src="https://cdn.insertchat.com/widget.js"
          data-agent="b47172c4-340f-48d9-914e-179b520287be"
          async
        />
      </body>
    </html>
  )
}
