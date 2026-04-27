"use client"

import { use } from "react"
import { useQuery } from "@tanstack/react-query"
import { Award, CheckCircle2, XCircle, MapPin, Calendar, Loader2 } from "lucide-react"
import Link from "next/link"

interface VerifyResponse {
  valid: boolean
  reason?: string
  member?: {
    name: string | null
    amasi_number: number
    profile_photo: string | null
  }
  credential?: {
    type: "FMAS" | "MMAS" | "DIPMAS" | "COURSE_CERT"
    course_id: number | null
    course_name: string | null
    course_place: string | null
    year: number
    awarded_at: string | null
  }
}

const CRED_LABEL: Record<string, string> = {
  FMAS: "Fellow of Minimal Access Surgery",
  MMAS: "Master of Minimal Access Surgery",
  DIPMAS: "Diplomate of Minimal Access Surgery",
  COURSE_CERT: "Course Certificate",
}

export default function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)

  const { data, isLoading, isError } = useQuery<VerifyResponse>({
    queryKey: ["verify", token],
    queryFn: async () => {
      const res = await fetch(`/api/verify/credential?token=${encodeURIComponent(token)}`)
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-6">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-amber-600" />
          <p className="text-sm text-muted-foreground mt-3">Verifying credential…</p>
        </div>
      </div>
    )
  }

  if (isError || !data || !data.valid) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-950 border rounded-2xl shadow-xl p-8 text-center">
          <div className="h-14 w-14 rounded-full bg-red-50 dark:bg-red-500/15 flex items-center justify-center mx-auto mb-4">
            <XCircle className="h-7 w-7 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-xl font-bold mb-1">Verification failed</h1>
          <p className="text-sm text-muted-foreground">
            {data?.reason ?? "This verification link is invalid or has expired."}
          </p>
          <Link
            href="https://amasi.org"
            className="inline-block mt-6 text-sm text-amber-700 dark:text-amber-400 hover:underline"
          >
            Visit amasi.org
          </Link>
        </div>
      </div>
    )
  }

  const m = data.member!
  const c = data.credential!
  const place = c.course_place

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-slate-50 to-slate-100 dark:from-amber-950/20 dark:via-slate-950 dark:to-slate-900 p-6 flex items-center justify-center">
      <div className="max-w-md w-full">
        {/* Verified badge */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
            Verified by AMASI
          </span>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-950 border rounded-2xl shadow-xl overflow-hidden">
          {/* Header band */}
          <div className="bg-gradient-to-br from-amber-100 to-amber-50 dark:from-amber-500/20 dark:to-amber-500/5 p-6 border-b border-amber-200/70 dark:border-amber-400/30">
            <div className="flex items-start gap-4">
              {m.profile_photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.profile_photo}
                  alt={m.name ?? "Member"}
                  className="h-16 w-16 rounded-full object-cover bg-white border-2 border-white shadow"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-white border-2 border-white shadow flex items-center justify-center text-amber-700 font-bold text-lg">
                  {(m.name ?? "?").split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("")}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-lg leading-tight">{m.name ?? "Unknown"}</h1>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  AMASI #{m.amasi_number}
                </p>
              </div>
              <Award className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
          </div>

          {/* Credential body */}
          <div className="p-6 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                Holds
              </div>
              <div className="text-base font-semibold">{CRED_LABEL[c.type] ?? c.type}</div>
              {c.course_name && (
                <div className="text-sm text-muted-foreground mt-1">{c.course_name}</div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div>
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                  <Calendar className="h-3 w-3" />
                  Year
                </div>
                <div className="font-semibold tabular-nums">{c.year}</div>
              </div>
              {place && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                    <MapPin className="h-3 w-3" />
                    Place
                  </div>
                  <div className="font-semibold">{place}</div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-slate-50 dark:bg-slate-900 px-6 py-3 border-t text-xs text-center text-muted-foreground">
            <p>
              Verified directly with AMASI&apos;s official member registry.
              <br />
              <Link href="https://amasi.org" className="hover:underline text-amber-700 dark:text-amber-400">
                amasi.org
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
