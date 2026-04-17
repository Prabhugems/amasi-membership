"use client"

import { Suspense } from "react"
import Link from "next/link"
import { Headphones, ArrowLeft, Loader2 } from "lucide-react"
import { AdminBackLink } from "@/components/ui/admin-back-link"
import { HelpButton } from "@/components/ui/help-button"
import { FAQSection } from "./components/FAQSection"
import { TicketCreationForm } from "./components/TicketCreationForm"
import { TicketTracker } from "./components/TicketTracker"

function SupportContent() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to AMASI
        </Link>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Headphones className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Support Center</h1>
          <p className="text-muted-foreground mt-2">
            Find answers, submit tickets, or track existing requests
          </p>
        </div>

        {/* FAQ Section */}
        <FAQSection />

        {/* Submit Ticket Form */}
        <TicketCreationForm />

        {/* Track Tickets */}
        <TicketTracker />
      </div>

      <HelpButton />
    </div>
  )
}

export default function SupportPage() {
  return (
    <>
      <AdminBackLink />
      <Suspense
        fallback={
          <div className="min-h-screen bg-background flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <SupportContent />
      </Suspense>
    </>
  )
}
