import type { Metadata } from "next"
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { QueryProvider } from "@/components/providers/query-provider"
import { SidebarProvider } from "@/components/providers/sidebar-provider"
import { MainContent } from "@/components/layout/main-content"
import { CommandPaletteProvider } from "@/components/command/command-palette-provider"
import { ShortcutHelp } from "@/components/keyboard/shortcut-help"
import { NavChord } from "@/components/keyboard/nav-chord"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { FocusModeProvider } from "@/components/providers/focus-mode-provider"
import { ExitFocusPill } from "@/components/focus/exit-focus-pill"
import { ViewTransitions } from "@/components/transitions/view-transitions"
import { PageTransition } from "@/components/transitions/page-transition"
import { DynamicTitle } from "@/components/header/dynamic-title"
import { Toaster } from "sonner"

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
})

const interTight = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "AMASI — Membership Management System",
    template: "%s | AMASI",
  },
  description:
    "Association of Minimal Access Surgeons of India — Apply for membership, track applications, verify members, download certificates, and manage your profile.",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "AMASI — Membership Management System",
    description:
      "Association of Minimal Access Surgeons of India — Apply for membership, track applications, verify members, download certificates, and manage your profile.",
    siteName: "AMASI",
    type: "website",
    locale: "en_IN",
  },
  metadataBase: new URL("https://membership.amasi.org"),
  alternates: {
    canonical: "/",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${interTight.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background">
        <QueryProvider>
          <ThemeProvider defaultTheme="system">
            <SidebarProvider>
              <FocusModeProvider>
                <CommandPaletteProvider>
                  <ViewTransitions />
                  <DynamicTitle />
                  <NavChord />
                  <ShortcutHelp />
                  <Sidebar />
                  <MainContent>
                    <Header />
                    <main className="p-6">
                      <PageTransition>{children}</PageTransition>
                    </main>
                  </MainContent>
                </CommandPaletteProvider>
                <ExitFocusPill />
              </FocusModeProvider>
            </SidebarProvider>
          </ThemeProvider>
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
