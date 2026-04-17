"use client"

import { useState } from "react"
import {
  HelpCircle, Clock, CreditCard, Search, UserCog, FileText,
  Shield, AlertCircle, BookOpen, ChevronDown, ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

const FAQ_ITEMS = [
  {
    question: "How long does application review take?",
    answer: "Applications are typically reviewed within 1-2 business days. You will receive an email notification once your application has been processed.",
    icon: Clock,
  },
  {
    question: "How do I download my membership card?",
    answer: "Login to the Member Portal and go to the Card section. You can download a digital copy of your membership card from there.",
    icon: CreditCard,
  },
  {
    question: "I forgot my reference number",
    answer: "Use your email or phone number to track your application status in the 'Track My Tickets' section below. You can also search for your application using the same details on the main portal.",
    icon: Search,
  },
  {
    question: "How do I update my profile?",
    answer: "Visit the Profile section of the Member Portal and verify your identity with OTP. Once verified, you can update your personal and professional details.",
    icon: UserCog,
  },
  {
    question: "What documents are required for membership?",
    answer: "You need to upload: (1) a recent passport-size Photo, (2) PG Degree Certificate, and (3) MCI/NMC Registration Certificate. All documents should be clear, legible scans or photos.",
    icon: FileText,
  },
  {
    question: "What are the membership fees?",
    answer: "Membership fees vary by category. Please refer to the membership application page for the latest fee structure. Payments can be made online via UPI, credit/debit card, or net banking.",
    icon: CreditCard,
  },
  {
    question: "How do I renew my membership?",
    answer: "Login to the Member Portal and navigate to the Renewal section. Follow the prompts to complete your renewal before the expiry date to avoid any lapse in membership benefits.",
    icon: Shield,
  },
  {
    question: "My payment was deducted but application shows pending",
    answer: "Payment reconciliation may take up to 30 minutes. If the issue persists after that, please submit a support ticket with your transaction ID and screenshot of the payment confirmation.",
    icon: AlertCircle,
  },
  {
    question: "Can I change my membership category after applying?",
    answer: "Category changes are possible before your application is approved. Please submit a support ticket with your reference number and the desired category change, and our team will assist you.",
    icon: BookOpen,
  },
  {
    question: "Who is eligible for AMASI membership?",
    answer: "AMASI membership is open to qualified anesthesiologists who hold a recognized postgraduate degree (MD/DA/DNB) in Anesthesiology and are registered with MCI/NMC or the respective State Medical Council.",
    icon: HelpCircle,
  },
]

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  const displayed = showAll ? FAQ_ITEMS : FAQ_ITEMS.slice(0, 5)

  return (
    <Card className="rounded-xl mb-10">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-primary" />
          Frequently Asked Questions
        </CardTitle>
        <CardDescription>
          Find quick answers before submitting a ticket
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {displayed.map((item, idx) => {
          const isOpen = openIndex === idx
          const Icon = item.icon
          return (
            <button
              key={idx}
              onClick={() => setOpenIndex(isOpen ? null : idx)}
              className="w-full text-left min-h-[44px]"
              aria-expanded={isOpen}
              aria-controls={`faq-answer-${idx}`}
            >
              <div
                className={`rounded-lg px-4 py-3 transition-all ${
                  isOpen
                    ? "bg-primary/5 border border-primary/20"
                    : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`shrink-0 h-8 w-8 rounded-lg flex items-center justify-center ${
                    isOpen ? "bg-primary/10" : "bg-muted/60"
                  }`}>
                    <Icon className={`h-4 w-4 ${isOpen ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <span className={`flex-1 text-sm font-medium ${isOpen ? "text-primary" : ""}`}>
                    {item.question}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
                {isOpen && (
                  <div
                    id={`faq-answer-${idx}`}
                    className="mt-2 ml-11 text-sm text-muted-foreground leading-relaxed pb-1"
                  >
                    {item.answer}
                  </div>
                )}
              </div>
            </button>
          )
        })}
        {FAQ_ITEMS.length > 5 && (
          <div className="pt-2 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll(!showAll)}
              className="text-primary"
            >
              {showAll ? "Show fewer" : `Show all ${FAQ_ITEMS.length} questions`}
              <ChevronRight className={`h-4 w-4 ml-1 transition-transform ${showAll ? "rotate-90" : ""}`} />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
