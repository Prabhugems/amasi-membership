"use client"

import { useState } from "react"
import { MessageCircle, Mail, Phone, X, HelpCircle, Ticket } from "lucide-react"
import Link from "next/link"

const WHATSAPP_NUMBER = "917358105244"
const EMAIL = "membership@amasi.org"
const PHONE = "+91 7358105244"

export function HelpButton() {
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3">
      {open && (
        <div className="bg-card border border-border rounded-2xl shadow-2xl w-72 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="bg-primary px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary-foreground">
              <HelpCircle className="h-4 w-4" />
              <span className="text-sm font-semibold">Need Help?</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close help menu"
              className="text-primary-foreground/80 hover:text-primary-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-3 space-y-1.5">
            <p className="text-xs text-muted-foreground px-1 pb-1">
              Having trouble with the form? Reach out to us:
            </p>
            <Link
              href="/support"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-primary/5 transition-colors group"
            >
              <div className="h-9 w-9 rounded-full bg-primary flex items-center justify-center shrink-0">
                <Ticket className="h-4.5 w-4.5 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-primary">Submit a Ticket</p>
                <p className="text-xs text-muted-foreground">Track your issue</p>
              </div>
            </Link>
            <div className="border-t mx-1" />
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hi, I need help with my AMASI membership application.")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-green-50 transition-colors group"
            >
              <div className="h-9 w-9 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                <MessageCircle className="h-4.5 w-4.5 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-green-700">WhatsApp</p>
                <p className="text-xs text-muted-foreground">{PHONE}</p>
              </div>
            </a>
            <a
              href={`mailto:${EMAIL}?subject=${encodeURIComponent("Help with AMASI Membership Application")}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-blue-50 transition-colors group"
            >
              <div className="h-9 w-9 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                <Mail className="h-4.5 w-4.5 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-blue-700">Email</p>
                <p className="text-xs text-muted-foreground">{EMAIL}</p>
              </div>
            </a>
            <a
              href={`tel:${PHONE}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-purple-50 transition-colors group"
            >
              <div className="h-9 w-9 rounded-full bg-purple-500 flex items-center justify-center shrink-0">
                <Phone className="h-4.5 w-4.5 text-white" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-purple-700">Call Us</p>
                <p className="text-xs text-muted-foreground">{PHONE}</p>
              </div>
            </a>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close help menu" : "Open help menu"}
        aria-expanded={open}
        className={`h-14 w-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          open
            ? "bg-muted text-muted-foreground hover:bg-muted/80"
            : "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105"
        }`}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  )
}
