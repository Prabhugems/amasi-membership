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
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-amber-50 via-white to-orange-50/30 dark:from-amber-950/30 dark:via-slate-950 dark:to-slate-900 p-6 flex items-center justify-center">
      {/* Ambient blobs */}
      <div
        aria-hidden="true"
        className="absolute top-0 -left-24 h-96 w-96 rounded-full bg-gradient-to-br from-amber-200/40 to-orange-300/20 dark:from-amber-500/10 dark:to-orange-600/5 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-0 -right-24 h-96 w-96 rounded-full bg-gradient-to-br from-amber-300/30 to-yellow-200/20 dark:from-amber-700/10 dark:to-yellow-500/5 blur-3xl pointer-events-none"
      />

      <div className="relative max-w-md w-full animate-in fade-in zoom-in-95 duration-500">
        {/* Verified pill */}
        <div className="flex items-center justify-center gap-2 mb-5">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 dark:bg-emerald-400/10 border border-emerald-300/50 dark:border-emerald-400/30 backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-[0.14em]">
              Verified by AMASI
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="relative bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border border-amber-200/40 dark:border-amber-400/20 rounded-3xl shadow-2xl shadow-amber-500/10 dark:shadow-amber-500/5 overflow-hidden">
          {/* Hero band */}
          <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 via-amber-400 to-orange-400 dark:from-amber-700 dark:via-amber-800 dark:to-amber-950 p-6 pb-7">
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 25% 30%, rgba(255,255,255,0.5) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.25) 0%, transparent 35%)",
              }}
            />
            <div className="relative flex items-start gap-4">
              {m.profile_photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.profile_photo}
                  alt={m.name ?? "Member"}
                  className="h-20 w-20 rounded-full object-cover ring-4 ring-white/80 shadow-xl shrink-0"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-white ring-4 ring-white/80 shadow-xl flex items-center justify-center text-amber-700 font-bold text-2xl shrink-0">
                  {(m.name ?? "?")
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((s) => s[0]?.toUpperCase())
                    .join("")}
                </div>
              )}
              <div className="flex-1 min-w-0 pt-1">
                <h1 className="font-bold text-xl text-white leading-tight drop-shadow-sm">
                  {m.name ?? "Unknown"}
                </h1>
                <p className="text-xs text-white/85 font-mono mt-1 inline-block bg-white/15 backdrop-blur px-2 py-0.5 rounded">
                  AMASI #{m.amasi_number}
                </p>
              </div>
              <div className="h-9 w-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0 ring-1 ring-white/30">
                <Award className="h-5 w-5 text-white" />
              </div>
            </div>
          </div>

          {/* Credential body */}
          <div className="p-6 space-y-5">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400 font-bold mb-1.5">
                Holds
              </div>
              <div className="text-lg font-bold leading-snug">{CRED_LABEL[c.type] ?? c.type}</div>
              {c.course_name && (
                <div className="text-sm text-muted-foreground mt-1">{c.course_name}</div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-4 border-t border-dashed">
              <div className="rounded-xl bg-amber-50/60 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-400/15 p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
                  <Calendar className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  Year
                </div>
                <div className="font-bold text-base tabular-nums">{c.year}</div>
              </div>
              {place && (
                <div className="rounded-xl bg-amber-50/60 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-400/15 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">
                    <MapPin className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                    Place
                  </div>
                  <div className="font-bold text-base">{place}</div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gradient-to-b from-slate-50 to-slate-100/80 dark:from-slate-900 dark:to-slate-950 px-6 py-4 border-t text-xs text-center">
            <p className="text-muted-foreground leading-relaxed">
              This credential was verified directly with AMASI&apos;s official member registry.
            </p>
            <Link
              href="https://amasi.org"
              className="inline-block mt-2 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline tracking-wide"
            >
              amasi.org →
            </Link>
          </div>
        </div>

        {/* Powered-by */}
        <p className="text-center text-[11px] text-muted-foreground mt-5 tracking-wide">
          Association of Minimal Access Surgeons of India
        </p>
      </div>
    </div>
  )
}
