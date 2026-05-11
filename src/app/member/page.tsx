"use client"

import { useState, useRef, useEffect, Suspense, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import {
  Mail, RefreshCw, CreditCard, Award, UserPen, Clock, LogOut,
  Shield, ChevronRight, LayoutDashboard, FileText, Upload, ShieldCheck,
  User, Users, MapPin, Phone, GraduationCap, CheckCircle, Bell, AlertTriangle,
  Ticket, ArrowRight, Eye, Download, ExternalLink, Calendar, Hash, Star,
  Activity, Lock, ArrowUpCircle, Sparkles, Paperclip, Send, MessageCircle,
  Inbox, Plus, X, Image, FileIcon, ChevronDown, Info, Loader2, RotateCw,
} from "lucide-react"
import { AdminBackLink } from "@/components/ui/admin-back-link"
import { useAdminRole } from "@/hooks/use-admin-role"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { toast } from "sonner"
import { formatDate, getInitials } from "@/lib/utils"
import Link from "next/link"
import { HelpButton } from "@/components/ui/help-button"
import { INDIAN_STATES } from "@/lib/membership-types"

type Phase = "login" | "otp" | "dashboard"
type Tab = "overview" | "card" | "certificate" | "profile" | "documents" | "support" | "upgrade"

// Session timeout in milliseconds (15 minutes)
const SESSION_TIMEOUT = 15 * 60 * 1000
const SESSION_WARNING = 13 * 60 * 1000 // warn at 13 min (2 min before timeout)

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-32 bg-muted rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1,2,3,4,5].map(i => <div key={i} className="h-24 bg-muted rounded-xl" />)}
      </div>
    </div>
  )
}

function MemberPortalContent() {
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<Phase>("login")
  const [email, setEmail] = useState("")
  const [member, setMember] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<Tab>("overview")
  // Drives the Admin Dashboard sidebar link gate below. `null` covers both
  // "still resolving /api/auth/me" and "not an admin" — same null-gate
  // semantics as the global Sidebar (commit 1ebc008). See AGENTS.md
  // "Admin UI gating" for the convention.
  const adminRole = useAdminRole()
  const [showSessionWarning, setShowSessionWarning] = useState(false)
  const [showSecurityNotice, setShowSecurityNotice] = useState(() => {
    if (typeof window === "undefined") return true
    const dismissed = localStorage.getItem("amasi_security_notice_dismissed")
    if (!dismissed) return true
    return Date.now() - parseInt(dismissed) > 30 * 24 * 60 * 60 * 1000
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const reduced = useReducedMotion()

  // OTP state
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""])
  const [isSending, setIsSending] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [otpSent, setOtpSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Session timeout refs
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null)
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null)

  const handleLogout = useCallback(() => {
    setPhase("login"); setEmail(""); setMember(null); setDigits(["", "", "", "", "", ""])
    setOtpSent(false); setError(null); setActiveTab("overview"); setShowSessionWarning(false)
    toast.info("Logged out")
  }, [])

  // Session timeout management
  const resetSessionTimer = useCallback(() => {
    if (phase !== "dashboard") return
    if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current)
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    setShowSessionWarning(false)
    warningTimerRef.current = setTimeout(() => setShowSessionWarning(true), SESSION_WARNING)
    sessionTimerRef.current = setTimeout(() => {
      handleLogout()
      toast.warning("Session expired due to inactivity")
    }, SESSION_TIMEOUT)
  }, [phase, handleLogout])

  useEffect(() => {
    if (phase !== "dashboard") return
    resetSessionTimer()
    const events = ["mousedown", "keydown", "scroll", "touchstart"]
    const handler = () => resetSessionTimer()
    events.forEach(e => window.addEventListener(e, handler, { passive: true }))
    return () => {
      events.forEach(e => window.removeEventListener(e, handler))
      if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current)
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    }
  }, [phase, resetSessionTimer])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleSendOtp = async () => {
    if (!email.trim()) { setError("Please enter your email"); return }
    setIsSending(true); setError(null)
    try {
      const res = await fetch("/api/otp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) })
      const data = await res.json()
      if (data.status) { setOtpSent(true); setCooldown(60); setPhase("otp"); toast.success("OTP sent to your email") }
      else setError(data.message || "Failed to send OTP")
    } catch { setError("Network error") }
    finally { setIsSending(false) }
  }

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const newDigits = [...digits]; newDigits[index] = value.slice(-1); setDigits(newDigits)
    if (value && index < 5) inputRefs.current[index + 1]?.focus()
    const code = newDigits.join("")
    if (code.length === 6) verifyOtp(code)
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) inputRefs.current[index - 1]?.focus()
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
    if (pasted.length === 6) { setDigits(pasted.split("")); verifyOtp(pasted) }
  }

  const verifyOtp = async (code: string) => {
    setIsVerifying(true); setError(null)
    try {
      const res = await fetch("/api/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), code }) })
      const data = await res.json()
      if (data.status) { toast.success("Verified!"); await fetchMemberData() }
      else { setError(data.message || "Invalid OTP"); setDigits(["", "", "", "", "", ""]); inputRefs.current[0]?.focus() }
    } catch { setError("Verification failed") }
    finally { setIsVerifying(false) }
  }

  const fetchMemberData = async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/members/search?q=${encodeURIComponent(email.trim())}`)
      const data = await res.json()
      if (data.status && data.data?.[0]) { setMember(data.data[0]); setPhase("dashboard") }
      else { setError("No membership found for this email"); setPhase("login") }
    } catch { setError("Failed to load data"); setPhase("login") }
    finally { setIsLoading(false) }
  }

  const maskedEmail = email.replace(/^(.{3})(.*)(@.*)$/, "$1***$3")
  const fullName = member ? [member.first_name, member.last_name].filter(Boolean).join(" ") : ""

  // Profile completeness calculation
  const getProfileCompleteness = () => {
    if (!member) return { percent: 0, missing: [] as string[] }
    const fields: { key: string; label: string; weight: number }[] = [
      { key: "profile_photo", label: "Profile Photo", weight: 15 },
      { key: "first_name", label: "First Name", weight: 10 },
      { key: "last_name", label: "Last Name", weight: 5 },
      { key: "email", label: "Email Address", weight: 10 },
      { key: "mobile", label: "Phone Number", weight: 10 },
      { key: "city", label: "City", weight: 5 },
      { key: "state", label: "State", weight: 5 },
      { key: "pg_degree", label: "PG Degree", weight: 10 },
      { key: "mci_council_number", label: "MCI Council Number", weight: 10 },
      { key: "mci_certificate", label: "MCI Certificate", weight: 10 },
      { key: "pg_degree_certificate", label: "PG Degree Certificate", weight: 5 },
      { key: "mbbs_degree_certificate", label: "MBBS Certificate", weight: 5 },
    ]
    let score = 0
    const missing: string[] = []
    for (const f of fields) {
      if (member[f.key]) score += f.weight
      else missing.push(f.label)
    }
    return { percent: Math.min(score, 100), missing }
  }

  // Notification items
  const getNotifications = () => {
    if (!member) return []
    const items: { icon: typeof Bell; text: string; time: string; color: string }[] = []
    if (member.membership_no) {
      items.push({ icon: CheckCircle, text: "Your membership card is ready for download", time: "Available now", color: "text-green-500" })
    }
    if (member.membership_no) {
      items.push({ icon: Award, text: "Your certificate is ready for download", time: "Available now", color: "text-amber-500" })
    }
    if (member.updated_at) {
      items.push({ icon: Activity, text: "Profile updated successfully", time: formatDate(member.updated_at), color: "text-blue-500" })
    }
    if (member.membership_no) {
      items.push({ icon: Star, text: `Membership active - AMASI #${member.membership_no}`, time: "Current", color: "text-primary" })
    }
    return items
  }

  // FMAS credential check
  const fmasQuery = useQuery({
    queryKey: ["fmas-credential", member?.amasi_number],
    queryFn: async () => {
      if (!member?.amasi_number) return { credential: null }
      const res = await fetch(`/api/credential?type=FMAS&id=${member.amasi_number}`)
      if (res.status === 404) return { credential: null }
      return res.json()
    },
    enabled: !!member?.amasi_number && phase === "dashboard",
    retry: false,
  })

  const hasFmas = !!fmasQuery.data?.credential

  // ===== LOGIN =====
  if (phase === "login") {
    return (
      <div className="min-h-screen flex">
        {/* Left side - Login form */}
        <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">
          {/* Subtle background pattern */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />

          <div className="w-full max-w-md space-y-8 relative z-10">
            {/* Logo and branding */}
            <div className="text-center space-y-4">
              <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="text-primary-foreground font-bold text-3xl tracking-tight">A</span>
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">AMASI</h1>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  Association of Minimal Access Surgeons of India
                </p>
                <p className="text-sm font-medium text-primary mt-0.5">Member Portal</p>
              </div>
            </div>

            {/* Login card */}
            <Card className="shadow-xl shadow-black/5 border-0 bg-card/80 backdrop-blur-sm">
              <CardContent className="pt-8 pb-8 px-8 space-y-5">
                <div className="text-center mb-2">
                  <h2 className="text-lg font-semibold">Sign in to your account</h2>
                  <p className="text-sm text-muted-foreground mt-1">We will send a one-time code to your email</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Email Address</label>
                  <div className="relative mt-1.5">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input type="email" placeholder="your.email@example.com" value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(null) }}
                      onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                      className="pl-10 h-12 text-base" disabled={isSending} />
                  </div>
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 rounded-lg p-3">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}
                <Button className="w-full h-11 font-semibold text-base" onClick={handleSendOtp} disabled={isSending || !email.trim()}>
                  {isSending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Sending OTP...</>
                  ) : (
                    <>Sign In with OTP <ArrowRight className="h-4 w-4 ml-2" /></>
                  )}
                </Button>
              </CardContent>
            </Card>

            <div className="text-center space-y-3">
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs"><span className="bg-background px-3 text-muted-foreground">Not a member yet?</span></div>
              </div>
              <a href="/apply" className="inline-flex items-center gap-1.5 text-sm text-primary font-semibold hover:underline">
                Apply for Membership <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Right side - Benefits sidebar */}
        <div className="hidden lg:flex w-[420px] bg-gradient-to-br from-primary to-primary/90 text-primary-foreground p-10 flex-col justify-center relative overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute top-[-80px] right-[-80px] w-[250px] h-[250px] rounded-full bg-white/5" />
          <div className="absolute bottom-[-60px] left-[-60px] w-[200px] h-[200px] rounded-full bg-white/5" />
          <div className="absolute top-1/2 right-[-30px] w-[100px] h-[100px] rounded-full bg-white/5" />

          <div className="relative z-10 space-y-8">
            <div>
              <h2 className="text-2xl font-bold leading-tight">Access your<br/>membership portal</h2>
              <p className="text-primary-foreground/70 mt-3 text-sm leading-relaxed">
                Everything you need as an AMASI member, right at your fingertips.
              </p>
            </div>

            <div className="space-y-5">
              {[
                { icon: CreditCard, title: "Digital Membership Card", desc: "View and download your AMASI membership card anytime" },
                { icon: Award, title: "Certificates", desc: "Download your official membership certificate" },
                { icon: UserPen, title: "Profile Management", desc: "Keep your professional details and documents up to date" },
                { icon: ShieldCheck, title: "Verification", desc: "QR-verifiable membership credentials for conferences" },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-white/10 shrink-0">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{item.title}</p>
                    <p className="text-xs text-primary-foreground/60 mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-white/10">
              <p className="text-xs text-primary-foreground/50">
                Secure OTP-based login &mdash; no password required.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ===== OTP =====
  if (phase === "otp") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />

        <div className="w-full max-w-md space-y-6 relative z-10">
          <div className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center ring-4 ring-primary/5">
              <Mail className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Verify Your Email</h1>
              <p className="text-muted-foreground text-sm mt-2">
                Enter the 6-digit code sent to<br/>
                <strong className="text-foreground">{maskedEmail}</strong>
              </p>
            </div>
          </div>
          <Card className="shadow-xl shadow-black/5 border-0">
            <CardContent className="pt-8 pb-8 px-8 space-y-5">
              <div className="flex justify-center gap-2.5" onPaste={handlePaste}>
                {digits.map((digit, i) => (
                  <Input key={i} ref={(el) => { inputRefs.current[i] = el }} type="text" inputMode="numeric" maxLength={1}
                    value={digit} onChange={(e) => handleDigitChange(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-bold rounded-xl" disabled={isVerifying || isLoading} />
                ))}
              </div>
              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 rounded-lg p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
              {(isVerifying || isLoading) && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  {isVerifying ? "Verifying..." : "Loading your profile..."}
                </div>
              )}
              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={handleSendOtp} disabled={isSending || cooldown > 0}>
                  <RefreshCw className="h-4 w-4 mr-1.5" />{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className="text-center">
            <Button variant="link" onClick={() => { setPhase("login"); setDigits(["","","","","",""]); setError(null) }} className="text-muted-foreground">
              <ChevronRight className="h-4 w-4 mr-1 rotate-180" /> Use a different email
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ===== LOADING SKELETON (between OTP verify and dashboard) =====
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <div className="w-full max-w-4xl">
          <DashboardSkeleton />
        </div>
      </div>
    )
  }

  // ===== DASHBOARD WITH SIDEBAR =====
  if (phase === "dashboard" && member) {
    const memberType = member.application_name || member.membership_type || ""
    const amasiNum = member.membership_no || member.amasi_number
    const profileData = getProfileCompleteness()
    const notifications = getNotifications()

    const isACM = memberType.toUpperCase().includes("ACM") || memberType.toUpperCase().includes("CANDIDATE")

    // Document counts for badge
    const docFields = ["profile_photo", "mci_certificate", "pg_degree_certificate", "mbbs_degree_certificate", "asi_member_certificate", "active_license", "letter_hod"]
    const docsUploaded = docFields.filter(k => member[k]).length
    const docsRequired = member.membership_type?.toUpperCase() === "ACM" ? 4 : 3
    const hasProfilePhoto = !!member.profile_photo

    const sidebarItems: { id: Tab; label: string; icon: typeof LayoutDashboard; badge?: string }[] = [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "card", label: "Membership Card", icon: CreditCard },
      { id: "certificate", label: "Certificate", icon: Award },
      { id: "profile", label: "My Profile", icon: User, badge: profileData.percent < 100 ? `${profileData.percent}%` : undefined },
      { id: "documents", label: "Documents", icon: Upload, badge: docsUploaded < docsRequired ? `${docsUploaded}/${docsRequired}` : undefined },
      ...(isACM ? [{ id: "upgrade" as Tab, label: "Upgrade Membership", icon: Star }] : []),
      { id: "support", label: "Support", icon: Ticket },
    ]

    // Circular progress ring SVG params
    const ringSize = 80
    const ringStroke = 6
    const ringRadius = (ringSize - ringStroke) / 2
    const ringCircumference = 2 * Math.PI * ringRadius
    const ringOffset = ringCircumference - (profileData.percent / 100) * ringCircumference

    return (
      <div className="min-h-screen flex bg-muted/30">
        {/* Session timeout warning */}
        {showSessionWarning && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-in slide-in-from-top duration-300">
            <Clock className="h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-semibold">Session expiring soon</p>
              <p className="text-xs text-amber-600">Your session will expire in 2 minutes due to inactivity.</p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100" onClick={resetSessionTimer}>
              Stay Signed In
            </Button>
          </div>
        )}

        {/* Mobile sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="lg:hidden fixed top-4 left-4 z-40 p-2 bg-card rounded-lg border shadow-sm"
        >
          <LayoutDashboard className="h-5 w-5" />
        </button>

        {/* Sidebar overlay on mobile */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Member Sidebar */}
        <aside className={`fixed lg:sticky top-0 left-0 h-screen w-72 border-r bg-card flex flex-col shrink-0 z-30 transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
          {/* Header */}
          <div className="h-16 flex items-center gap-3 border-b px-5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-sm">
              <span className="text-primary-foreground font-bold text-sm">A</span>
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-tight">AMASI</h1>
              <p className="text-[10px] text-muted-foreground leading-tight">Member Portal</p>
            </div>
          </div>

          {/* Profile summary */}
          <div className="p-5 border-b bg-gradient-to-b from-primary/5 to-transparent">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 ring-2 ring-primary/20">
                <AvatarImage src={member.profile_photo || member.profile} />
                <AvatarFallback className="text-sm bg-primary/10 text-primary font-semibold">{getInitials(fullName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">Dr. {fullName}</p>
                <p className="text-[11px] text-muted-foreground font-mono tracking-wide">#{amasiNum}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Badge variant="secondary" className="text-xs">{memberType}</Badge>
              <Badge variant="outline" className="text-xs text-green-600 border-green-200 bg-green-50">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 inline-block" />
                Active
              </Badge>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            {sidebarItems.map((item) => {
              // Insert the Member Directory external link between Documents
              // and Support. It's a Link (real route), not a tab swap — the
              // rest of the sidebar uses setActiveTab which only changes
              // local state.
              const button = (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); setSidebarOpen(false) }}
                  className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
                    activeTab === item.id
                      ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                  {item.badge && activeTab !== item.id && (
                    <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">{item.badge}</span>
                  )}
                  {activeTab === item.id && <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
                </button>
              )
              if (item.id === "support") {
                return [
                  <Link
                    key="directory"
                    href="/directory"
                    onClick={() => setSidebarOpen(false)}
                    className="w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    Member Directory
                  </Link>,
                  button,
                ]
              }
              return button
            })}
          </nav>

          {/* Footer */}
          <div className="p-3 border-t space-y-1">
            {adminRole && (
              <a href="/" className="flex items-center gap-2.5 px-3.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-xl hover:bg-accent">
                <ShieldCheck className="h-3.5 w-3.5" /> Admin Dashboard
              </a>
            )}
            <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-muted-foreground hover:text-destructive transition-colors rounded-xl hover:bg-destructive/5">
              <LogOut className="h-3.5 w-3.5" /> Sign Out
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-screen">
          {/* Top bar */}
          <header className="sticky top-0 z-20 h-14 border-b bg-card/80 backdrop-blur-sm flex items-center justify-between px-6 lg:px-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground pl-10 lg:pl-0">
              <Lock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Signed in as</span>
              <span className="font-medium text-foreground">{email}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-destructive">
              <LogOut className="h-4 w-4 mr-1.5" /> Logout
            </Button>
          </header>

          <main className="flex-1 p-6 lg:p-8 overflow-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: -40 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="max-w-4xl space-y-6">
                {/* Welcome banner */}
                <div className="rounded-2xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground p-6 lg:p-8 relative overflow-hidden">
                  <div className="absolute top-[-40px] right-[-40px] w-[150px] h-[150px] rounded-full bg-white/5" />
                  <div className="absolute bottom-[-20px] right-[80px] w-[80px] h-[80px] rounded-full bg-white/5" />
                  <div className="relative flex items-center gap-5">
                    <Avatar className="h-16 w-16 lg:h-20 lg:w-20 ring-4 ring-white/20 shrink-0">
                      <AvatarImage src={member.profile_photo || member.profile} />
                      <AvatarFallback className="text-xl bg-white/20 text-primary-foreground font-bold">{getInitials(fullName)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <h2 className="text-xl lg:text-2xl font-bold">Welcome back, Dr. {fullName}</h2>
                      <p className="text-primary-foreground/70 text-sm mt-1">AMASI #{amasiNum}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <Badge className="bg-white/15 text-primary-foreground border-white/20 text-xs">{memberType}</Badge>
                        {member.zone && <Badge className="bg-white/15 text-primary-foreground border-white/20 text-xs">{member.zone} Zone</Badge>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Security notice banner — dismissible, 30-day persistence */}
                {showSecurityNotice && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/80 dark:bg-blue-950/30 dark:border-blue-900/50 p-4 relative">
                    <button
                      onClick={() => {
                        setShowSecurityNotice(false)
                        localStorage.setItem("amasi_security_notice_dismissed", String(Date.now()))
                      }}
                      className="absolute top-3 right-3 text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300 transition-colors"
                      aria-label="Dismiss notice"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <div className="flex gap-3 pr-6">
                      <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-semibold text-blue-900 dark:text-blue-200 mb-1">Support Ticket Access Updated</p>
                        <p className="text-blue-800/80 dark:text-blue-300/80 leading-relaxed">
                          As part of our commitment to data security, access to support tickets now requires signing in to your member account. Direct links from older support emails will no longer open tickets automatically. To view your tickets, navigate to the Support section from this dashboard.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ACM Membership expiry/renewal banner */}
                {(() => {
                  const rawType = (member.membership_type || "").toUpperCase()
                  if (rawType !== "ACM") return null
                  const jd = member.joining_date || member.created_at
                  if (!jd) return null
                  const joiningDate = new Date(jd)
                  const expiryDate = new Date(joiningDate)
                  expiryDate.setFullYear(expiryDate.getFullYear() + 1)
                  const now = new Date()
                  const diffMs = expiryDate.getTime() - now.getTime()
                  const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
                  const expiryStr = expiryDate.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })

                  if (daysUntilExpiry < 0) {
                    return (
                      <div className="rounded-xl border border-red-200 bg-red-50/80 dark:bg-red-950/30 dark:border-red-900/50 p-4">
                        <div className="flex gap-3">
                          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                          <div className="text-sm">
                            <p className="font-semibold text-red-900 dark:text-red-200 mb-1">Membership Expired</p>
                            <p className="text-red-800/80 dark:text-red-300/80 leading-relaxed">
                              Your ACM membership expired on {expiryStr}. Upgrade to Life Member or Associate Life Member to continue.
                            </p>
                            <Button size="sm" className="mt-2 h-7 text-xs bg-red-600 hover:bg-red-700 text-white" onClick={() => setActiveTab("upgrade")}>
                              Upgrade Now <ArrowRight className="h-3 w-3 ml-1" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  if (daysUntilExpiry <= 30) {
                    return (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-900/50 p-4">
                        <div className="flex gap-3">
                          <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div className="text-sm">
                            <p className="font-semibold text-amber-900 dark:text-amber-200 mb-1">Membership Expiring Soon</p>
                            <p className="text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
                              Your ACM membership expires on {expiryStr}. Upgrade to Life Member or Associate Life Member.
                            </p>
                            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-100" onClick={() => setActiveTab("upgrade")}>
                              Upgrade Membership <ArrowRight className="h-3 w-3 ml-1" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  return null
                })()}

                {/* Membership status + Profile completeness */}
                <div className="grid gap-4 lg:grid-cols-3">
                  {/* Membership status card */}
                  <Card className="lg:col-span-2">
                    <CardContent className="p-6">
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-4">Membership Status</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Membership Type</p>
                          <p className="font-semibold text-sm">{memberType || "N/A"}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">AMASI Number</p>
                          <p className="font-semibold text-sm font-mono">#{amasiNum || "N/A"}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Member Since</p>
                          <p className="font-semibold text-sm">{formatDate(member.created_at)}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Status</p>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            <p className="font-semibold text-sm text-green-600">Active</p>
                          </div>
                        </div>
                      </div>
                      {member.application_no && (
                        <div className="mt-4 pt-3 border-t">
                          <a
                            href={`/api/payments/receipt?ref=${encodeURIComponent(member.application_no)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download Payment Receipt
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Profile completeness */}
                  <Card>
                    <CardContent className="p-6 flex flex-col items-center text-center">
                      <div className="relative mb-3">
                        <svg width={ringSize} height={ringSize} className="-rotate-90">
                          <circle cx={ringSize / 2} cy={ringSize / 2} r={ringRadius} fill="none" stroke="currentColor" strokeWidth={ringStroke} className="text-muted/30" />
                          <circle cx={ringSize / 2} cy={ringSize / 2} r={ringRadius} fill="none" stroke="currentColor" strokeWidth={ringStroke}
                            strokeDasharray={ringCircumference} strokeDashoffset={ringOffset} strokeLinecap="round"
                            className={profileData.percent >= 80 ? "text-green-500" : profileData.percent >= 50 ? "text-amber-500" : "text-red-500"}
                            style={{ transition: "stroke-dashoffset 1s ease" }}
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">
                          {profileData.percent}%
                        </span>
                      </div>
                      <p className="text-sm font-semibold">Profile Complete</p>
                      {profileData.missing.length > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                          Add {profileData.missing[0].toLowerCase()} to improve
                        </p>
                      )}
                      {profileData.missing.length > 0 && (
                        <Button variant="link" size="sm" className="text-xs mt-1 h-auto p-0" onClick={() => setActiveTab("profile")}>
                          Complete Profile
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Quick Actions */}
                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      { tab: "card" as Tab, icon: CreditCard, title: "Membership Card", desc: "View & download your digital card", colors: "hover:border-blue-300 hover:bg-blue-50/50", iconBg: "bg-blue-100 text-blue-600" },
                      { tab: "certificate" as Tab, icon: Award, title: "Certificate", desc: "Download membership certificate", colors: "hover:border-amber-300 hover:bg-amber-50/50", iconBg: "bg-amber-100 text-amber-600" },
                      { tab: "profile" as Tab, icon: UserPen, title: "Edit Profile", desc: profileData.percent < 100 ? `${profileData.percent}% complete — update your details` : "Update your details & documents", colors: "hover:border-green-300 hover:bg-green-50/50", iconBg: "bg-green-100 text-green-600", badge: profileData.percent < 100 ? `${profileData.percent}%` : undefined },
                      { tab: "documents" as Tab, icon: Upload, title: "Upload Documents", desc: !hasProfilePhoto ? "Profile photo missing — upload now" : `${docsUploaded} documents uploaded`, colors: "hover:border-purple-300 hover:bg-purple-50/50", iconBg: "bg-purple-100 text-purple-600", badge: !hasProfilePhoto ? "Photo needed" : docsUploaded < docsRequired ? `${docsUploaded}/${docsRequired}` : undefined },
                      { tab: "support" as Tab, icon: Ticket, title: "Support Tickets", desc: "Get help from AMASI team", colors: "hover:border-rose-300 hover:bg-rose-50/50", iconBg: "bg-rose-100 text-rose-600" },
                      ...(isACM ? [{ tab: "upgrade" as Tab, icon: Star, title: "Upgrade Membership", desc: "Upgrade to Life Member or Associate Life Member", colors: "hover:border-amber-300 hover:bg-amber-50/50", iconBg: "bg-amber-100 text-amber-600" }] : []),
                    ].map((action) => (
                      <button key={action.tab} onClick={() => setActiveTab(action.tab)} className={`group p-5 rounded-xl border bg-card transition-all text-left relative ${action.colors}`}>
                        <div className={`p-2.5 rounded-lg w-fit mb-3 ${action.iconBg}`}><action.icon className="h-5 w-5" /></div>
                        <p className="font-semibold text-sm">{action.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{action.desc}</p>
                        {(action as any).badge && (
                          <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{(action as any).badge}</span>
                        )}
                      </button>
                    ))}
                    <Link href="/directory" className="group p-5 rounded-xl border bg-card transition-all text-left relative hover:border-indigo-300 hover:bg-indigo-50/50">
                      <div className="p-2.5 rounded-lg w-fit mb-3 bg-indigo-100 text-indigo-600"><Users className="h-5 w-5" /></div>
                      <p className="font-semibold text-sm">Member Directory</p>
                      <p className="text-xs text-muted-foreground mt-1">Search AMASI members</p>
                    </Link>
                    {hasFmas && (
                      <Link href={`/member/fmas-certificate?id=${amasiNum}`} className="group p-5 rounded-xl border bg-card transition-all text-left relative hover:border-amber-300 hover:bg-amber-50/50">
                        <div className="p-2.5 rounded-lg w-fit mb-3 bg-amber-100 text-amber-600"><Award className="h-5 w-5" /></div>
                        <p className="font-semibold text-sm">FMAS Certificate</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Fellow of Minimal Access Surgery{fmasQuery.data?.credential?.year ? ` — awarded ${fmasQuery.data.credential.year}` : ""}
                        </p>
                        <div className="flex items-center text-xs text-primary mt-2">
                          View &amp; download <ChevronRight className="h-3 w-3 ml-0.5" />
                        </div>
                      </Link>
                    )}
                  </div>
                </div>

                {/* Notifications + Details row */}
                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Notifications */}
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <Bell className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Recent Updates</h3>
                      </div>
                      <div className="space-y-3">
                        {notifications.map((notif, i) => (
                          <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                            <notif.icon className={`h-4 w-4 mt-0.5 shrink-0 ${notif.color}`} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{notif.text}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{notif.time}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Contact & Verification */}
                  <Card>
                    <CardContent className="p-6">
                      <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-4">Your Details</h3>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 text-sm">
                          <div className="p-2 rounded-lg bg-muted"><Mail className="h-3.5 w-3.5 text-muted-foreground" /></div>
                          <span className="truncate">{member.email}</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <div className="p-2 rounded-lg bg-muted"><Phone className="h-3.5 w-3.5 text-muted-foreground" /></div>
                          <span>{member.mobile || member.phone || "Not provided"}</span>
                        </div>
                        {member.state && (
                          <div className="flex items-center gap-3 text-sm">
                            <div className="p-2 rounded-lg bg-muted"><MapPin className="h-3.5 w-3.5 text-muted-foreground" /></div>
                            <span>{[member.city, member.state].filter(Boolean).join(", ")}</span>
                          </div>
                        )}
                        {member.pg_degree && (
                          <div className="flex items-center gap-3 text-sm">
                            <div className="p-2 rounded-lg bg-muted"><GraduationCap className="h-3.5 w-3.5 text-muted-foreground" /></div>
                            <span>{member.pg_degree}</span>
                          </div>
                        )}
                        <div className="pt-2 border-t">
                          <h4 className="text-xs font-medium text-muted-foreground mb-2">Verification</h4>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-xs">
                              {member.mci_council_number ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span>MCI: {member.mci_council_number || "Not provided"}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              {member.asi_membership_no ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span>ASI: {member.asi_membership_no || "Not provided"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Profile completeness details (when incomplete) */}
                {profileData.missing.length > 0 && (
                  <Card className="border-amber-200 bg-amber-50/30">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-semibold text-sm">Complete your profile</h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            The following fields are missing: {profileData.missing.join(", ")}
                          </p>
                          <Button size="sm" className="mt-3 h-8 text-xs" onClick={() => setActiveTab("profile")}>
                            Update Profile <ArrowRight className="h-3 w-3 ml-1" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Card Tab */}
            {activeTab === "card" && (
              <div className="max-w-2xl space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Membership Card</h2>
                  <p className="text-muted-foreground text-sm mt-1">View and download your digital AMASI membership card</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <a href={`/card?id=${encodeURIComponent(member.email)}&direct=1`} target="_blank"
                    className="group p-8 rounded-2xl border-2 border-dashed hover:border-primary/40 hover:bg-primary/5 transition-all text-center">
                    <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <CreditCard className="h-8 w-8 text-primary" />
                    </div>
                    <p className="font-semibold text-lg">View & Download</p>
                    <p className="text-xs text-muted-foreground mt-2">Opens in a new tab with download option</p>
                    <div className="flex items-center justify-center gap-1.5 text-primary text-sm font-medium mt-3">
                      Open <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                  </a>
                  <a href={`/verify?id=${amasiNum}`} target="_blank"
                    className="group p-8 rounded-2xl border-2 border-dashed hover:border-green-400 hover:bg-green-50 transition-all text-center">
                    <div className="mx-auto w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <ShieldCheck className="h-8 w-8 text-green-600" />
                    </div>
                    <p className="font-semibold text-lg">Verify Membership</p>
                    <p className="text-xs text-muted-foreground mt-2">Public verification page with QR code</p>
                    <div className="flex items-center justify-center gap-1.5 text-green-600 text-sm font-medium mt-3">
                      Open <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                  </a>
                </div>
                <Card className="bg-muted/50">
                  <CardContent className="p-5 flex items-center gap-4">
                    <Hash className="h-8 w-8 text-primary shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Your AMASI Membership Number</p>
                      <p className="text-2xl font-bold font-mono tracking-wider text-primary">{amasiNum}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Certificate Tab */}
            {activeTab === "certificate" && (
              <div className="max-w-2xl space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Membership Certificate</h2>
                  <p className="text-muted-foreground text-sm mt-1">Download your official AMASI membership certificate</p>
                </div>
                <a href={`/member/certificate?id=${amasiNum}`} target="_blank"
                  className="group block p-10 rounded-2xl border-2 border-dashed hover:border-amber-400 hover:bg-amber-50 transition-all text-center">
                  <div className="mx-auto w-20 h-20 rounded-2xl bg-amber-100 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                    <Award className="h-10 w-10 text-amber-600" />
                  </div>
                  <p className="font-semibold text-xl">Download Certificate</p>
                  <p className="text-sm text-muted-foreground mt-2">Opens certificate with download & print options</p>
                  <p className="text-xs text-muted-foreground mt-3">AMASI #{amasiNum} &mdash; Signed by current President & Secretary</p>
                  <div className="flex items-center justify-center gap-1.5 text-amber-600 text-sm font-medium mt-4">
                    Open Certificate <ExternalLink className="h-3.5 w-3.5" />
                  </div>
                </a>
              </div>
            )}

            {/* Profile Tab */}
            {activeTab === "profile" && (
              <div className="max-w-3xl space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">My Profile</h2>
                  <p className="text-muted-foreground text-sm mt-1">Your membership information at a glance</p>
                </div>

                {/* Profile completeness inline */}
                {profileData.missing.length > 0 && (
                  <Card className="border-amber-200 bg-amber-50/30">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="relative shrink-0">
                          <svg width={48} height={48} className="-rotate-90">
                            <circle cx={24} cy={24} r={20} fill="none" stroke="currentColor" strokeWidth={4} className="text-muted/30" />
                            <circle cx={24} cy={24} r={20} fill="none" stroke="currentColor" strokeWidth={4}
                              strokeDasharray={2 * Math.PI * 20} strokeDashoffset={2 * Math.PI * 20 - (profileData.percent / 100) * 2 * Math.PI * 20}
                              strokeLinecap="round" className="text-amber-500" />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">{profileData.percent}%</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold">Profile {profileData.percent}% complete</p>
                          <p className="text-xs text-muted-foreground">Missing: {profileData.missing.join(", ")}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Personal Information */}
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <User className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold text-sm">Personal Information</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Full Name</p>
                        <p className="text-sm font-medium">{fullName || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Date of Birth</p>
                        <p className="text-sm font-medium">{member.date_of_birth ? formatDate(member.date_of_birth) : "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Gender</p>
                        <p className="text-sm font-medium">{member.gender || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Father&apos;s Name</p>
                        <p className="text-sm font-medium">{member.father_name || "--"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Contact Information */}
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Mail className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold text-sm">Contact Information</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Email</p>
                        <p className="text-sm font-medium">{member.email || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Phone</p>
                        <p className="text-sm font-medium">{member.mobile || member.phone || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">City</p>
                        <p className="text-sm font-medium">{member.city || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">State</p>
                        <p className="text-sm font-medium">{member.state || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Zone</p>
                        <p className="text-sm font-medium">{member.zone || "--"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Professional Information */}
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <GraduationCap className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold text-sm">Professional Information</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">PG Degree</p>
                        <p className="text-sm font-medium">{member.pg_degree || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">PG College</p>
                        <p className="text-sm font-medium">{member.pg_college || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">MCI Council Number</p>
                        <p className="text-sm font-medium">{member.mci_council_number || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">ASI Membership No.</p>
                        <p className="text-sm font-medium">{member.asi_membership_no || "--"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Membership Details */}
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Shield className="h-4 w-4 text-primary" />
                      <h3 className="font-semibold text-sm">Membership Details</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">AMASI Number</p>
                        <p className="text-sm font-medium">{member.membership_no || member.amasi_number || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Membership Type</p>
                        <p className="text-sm font-medium">{member.application_name || member.membership_type || "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Member Since</p>
                        <p className="text-sm font-medium">{member.created_at ? formatDate(member.created_at) : "--"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Last Updated</p>
                        <p className="text-sm font-medium">{member.updated_at ? formatDate(member.updated_at) : "--"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Edit Profile Link */}
                <div className="pt-2">
                  <a href={`/profile?q=${encodeURIComponent(member.email)}`} target="_blank"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                    <UserPen className="h-4 w-4" />
                    Edit Profile
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <p className="text-xs text-muted-foreground mt-2">Opens the profile editor in a new tab to update your details</p>
                </div>
              </div>
            )}

            {/* Documents Tab */}
            {activeTab === "documents" && (
              <DocumentsTab member={member} setMember={setMember} memberType={memberType} />
            )}

            {/* Support Tab */}
            {activeTab === "support" && (
              <MemberSupportTab member={member} />
            )}

            {/* Upgrade to LM Tab */}
            {activeTab === "upgrade" && (
              <MemberUpgradeTab member={member} memberType={memberType} amasiNum={amasiNum} />
            )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    )
  }

  return null
}

// ===================== DOCUMENTS TAB =====================

const DOC_SLOTS = [
  { label: "Profile Photo", field: "profile_photo", docType: "profile_photo", required: true, icon: User, accept: "image/jpeg,image/png" },
  { label: "MCI Certificate", field: "mci_certificate", docType: "mci_certificate", required: true, icon: FileText, accept: "image/jpeg,image/png,application/pdf" },
  { label: "PG Degree Certificate", field: "pg_degree_certificate", docType: "pg_degree_certificate", required: true, icon: GraduationCap, accept: "image/jpeg,image/png,application/pdf" },
  { label: "MBBS Degree", field: "mbbs_degree_certificate", docType: "mbbs_degree_certificate", required: false, icon: FileText, accept: "image/jpeg,image/png,application/pdf" },
  { label: "ASI Certificate", field: "asi_member_certificate", docType: "asi_member_certificate", required: false, icon: Award, accept: "image/jpeg,image/png,application/pdf" },
  { label: "Active License", field: "active_license", docType: "active_license", required: false, icon: Shield, accept: "image/jpeg,image/png,application/pdf" },
  { label: "HOD Letter", field: "letter_hod", docType: "letter_hod", required: false, icon: FileText, accept: "image/jpeg,image/png,application/pdf" },
] as const

function DocumentsTab({ member, setMember, memberType }: { member: any; setMember: (m: any) => void; memberType: string }) {
  const [uploadingField, setUploadingField] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const visibleDocs = DOC_SLOTS.filter(doc => {
    // ASI certificate only required/shown for Life Members
    if (doc.docType === "asi_member_certificate") {
      const isLM = memberType === "Life Member" || memberType === "LM"
      return isLM || !!member[doc.field]
    }
    return doc.required || !!member[doc.field]
  })

  const handleUpload = useCallback(async (file: File, docType: string, field: string) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large. Maximum 5 MB.")
      return
    }

    setUploadingField(field)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("memberId", member.id)
      formData.append("docType", docType)

      const res = await fetch("/api/members/upload", { method: "POST", body: formData })
      const data = await res.json()

      if (!res.ok || !data.status) {
        toast.error(data.message || "Upload failed")
        return
      }

      // Update local member state with the signed URL for immediate display
      setMember({ ...member, [field]: data.url })
      toast.success(`${DOC_SLOTS.find(d => d.field === field)?.label || "Document"} uploaded successfully`)
    } catch {
      toast.error("Upload failed. Please try again.")
    } finally {
      setUploadingField(null)
      // Reset the file input so the same file can be re-selected
      const input = fileInputRefs.current[field]
      if (input) input.value = ""
    }
  }, [member, setMember])

  const triggerFileInput = useCallback((field: string) => {
    fileInputRefs.current[field]?.click()
  }, [])

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">My Documents</h2>
        <p className="text-muted-foreground text-sm mt-1">Upload or view your membership documents</p>
      </div>
      <div className="grid gap-3">
        {visibleDocs.map((doc) => {
          const url = member[doc.field]
          const isUploading = uploadingField === doc.field
          const IconComponent = doc.icon

          return (
            <div key={doc.field} className="flex items-center justify-between p-4 rounded-xl border bg-card hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${url ? "bg-green-100" : "bg-muted"}`}>
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  ) : url ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <IconComponent className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">{doc.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {isUploading ? "Uploading..." : url ? "Uploaded" : doc.required ? "Required - Not uploaded" : "Optional - Not uploaded"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Hidden file input */}
                <input
                  type="file"
                  accept={doc.accept}
                  className="hidden"
                  ref={(el) => { fileInputRefs.current[doc.field] = el }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleUpload(file, doc.docType, doc.field)
                  }}
                />
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium">
                    <Eye className="h-3.5 w-3.5" /> View
                  </a>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  disabled={isUploading}
                  onClick={() => triggerFileInput(doc.field)}
                >
                  {isUploading ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Uploading</>
                  ) : url ? (
                    <><RotateCw className="h-3 w-3 mr-1" /> Replace</>
                  ) : (
                    <><Upload className="h-3 w-3 mr-1" /> Upload</>
                  )}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">Accepted formats: JPG, PNG, PDF. Maximum file size: 5 MB.</p>
    </div>
  )
}

// ===================== MEMBER SUPPORT TAB =====================

const TICKET_CATEGORIES = [
  "Application Issue", "Profile Update", "Payment Issue", "Certificate/Card", "Technical Issue", "Other",
]

function MemberSupportTab({ member }: { member: any }) {
  const [view, setView] = useState<"list" | "new" | "detail">("list")
  const [tickets, setTickets] = useState<any[]>([])
  const [selectedTicket, setSelectedTicket] = useState<any>(null)
  const [replies, setReplies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [replyText, setReplyText] = useState("")
  const [sendingReply, setSendingReply] = useState(false)

  // New ticket form
  const [category, setCategory] = useState("Other")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null)
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal")
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const repliesEndRef = useRef<HTMLDivElement>(null)
  const replyInputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replyFileInputRef = useRef<HTMLInputElement>(null)

  // Fetch tickets
  useEffect(() => {
    if (!member?.email) return
    setLoading(true)
    fetch(`/api/tickets?email=${encodeURIComponent(member.email)}`)
      .then(r => r.json())
      .then(d => setTickets(Array.isArray(d) ? d : []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false))
  }, [member?.email, submitted])

  // Auto-scroll to latest message
  useEffect(() => {
    if (view === "detail" && repliesEndRef.current) {
      repliesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [replies, view])

  // Generate attachment preview
  useEffect(() => {
    if (!attachment) { setAttachmentPreview(null); return }
    if (attachment.type.startsWith("image/")) {
      const url = URL.createObjectURL(attachment)
      setAttachmentPreview(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setAttachmentPreview(null)
    }
  }, [attachment])

  const handleSubmit = async () => {
    if (!subject.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: member.name || member.first_name || "Member",
          email: member.email,
          phone: member.phone || member.mobile,
          amasi_number: String(member.amasi_number || member.membership_no || ""),
          category,
          subject: subject.trim(),
          description: description.trim() + (attachment ? `\n\n📎 Attachment: ${attachment.name}` : ""),
          priority,
        }),
      })
      const data = await res.json()
      if (data.ticket_number || data.id) {
        setSubmitted(data.ticket_number || "Submitted")
        setSubject("")
        setDescription("")
        setCategory("Other")
        setPriority("normal")
        setAttachment(null)
        setAttachmentPreview(null)
        setTimeout(() => { setView("list"); setSubmitted(null) }, 3000)
      }
    } catch { /* ignore */ }
    finally { setSubmitting(false) }
  }

  const openTicket = async (ticket: any) => {
    setSelectedTicket(ticket)
    setView("detail")
    setReplies([])
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`)
      const data = await res.json()
      setReplies(data.replies || [])
    } catch { /* ignore */ }
  }

  const [replyFile, setReplyFile] = useState<File | null>(null)
  const [replyFilePreview, setReplyFilePreview] = useState<string | null>(null)

  useEffect(() => {
    if (!replyFile) { setReplyFilePreview(null); return }
    if (replyFile.type.startsWith("image/")) {
      const url = URL.createObjectURL(replyFile)
      setReplyFilePreview(url)
      return () => URL.revokeObjectURL(url)
    } else {
      setReplyFilePreview(null)
    }
  }, [replyFile])

  const handleReply = async () => {
    if (!replyText.trim() && !replyFile) return
    if (!selectedTicket) return
    setSendingReply(true)
    try {
      let res
      if (replyFile) {
        const fd = new FormData()
        fd.append("message", replyText.trim())
        fd.append("author_name", member.name || "Member")
        fd.append("as_member", "true")
        fd.append("attachment", replyFile)
        res = await fetch(`/api/tickets/${selectedTicket.id}/reply`, { method: "POST", body: fd })
      } else {
        res = await fetch(`/api/tickets/${selectedTicket.id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: replyText.trim(), as_member: true, author_name: member.name || "Member" }),
        })
      }
      const data = await res.json()
      if (data.id || data.message) {
        setReplies(prev => [...prev, data])
        setReplyText("")
        setReplyFile(null)
        setReplyFilePreview(null)
      }
    } catch { /* ignore */ }
    finally { setSendingReply(false) }
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && (file.type.startsWith("image/") || file.type === "application/pdf")) {
      setAttachment(file)
    }
  }

  const statusColor = (s: string) => {
    if (s === "open") return "bg-amber-50 text-amber-700 border border-amber-200"
    if (s === "in_progress") return "bg-blue-50 text-blue-700 border border-blue-200"
    if (s === "resolved") return "bg-emerald-50 text-emerald-700 border border-emerald-200"
    if (s === "closed") return "bg-gray-50 text-gray-500 border border-gray-200"
    return "bg-gray-50 text-gray-600 border border-gray-200"
  }

  const statusIcon = (s: string) => {
    if (s === "open") return <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
    if (s === "in_progress") return <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
    if (s === "resolved") return <CheckCircle className="h-3 w-3 text-emerald-500" />
    return <span className="w-2 h-2 rounded-full bg-gray-400" />
  }

  const statusLabel = (s: string) => {
    if (s === "in_progress") return "In Progress"
    return s?.charAt(0).toUpperCase() + s?.slice(1)
  }

  const extractAttachment = (msg: string | undefined) => {
    if (!msg) return { text: msg || "", url: null }
    const match = msg.match(/📎 Attachment: (https?:\/\/\S+)/)
    if (!match) return { text: msg, url: null }
    return {
      text: msg.replace(/📎 Attachment: (https?:\/\/\S+)/g, "").trim(),
      url: match[1],
    }
  }

  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)/i.test(url)

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Support</h2>
          <p className="text-muted-foreground text-sm mt-1">
            {view === "list" && "Your support tickets"}
            {view === "new" && "Create a new support ticket"}
            {view === "detail" && "Ticket conversation"}
          </p>
        </div>
        {view === "list" && (
          <Button onClick={() => setView("new")} className="gap-2 shadow-sm">
            <Plus className="h-4 w-4" /> New Ticket
          </Button>
        )}
        {view !== "list" && (
          <Button variant="ghost" onClick={() => { setView("list"); setSelectedTicket(null); setSubmitted(null) }} className="gap-2 text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-4 w-4 rotate-90" /> Back
          </Button>
        )}
      </div>

      {/* ============ NEW TICKET FORM ============ */}
      {view === "new" && !submitted && (
        <div className="space-y-5">
          {/* Category pills */}
          <div>
            <label className="text-sm font-medium text-foreground">Category</label>
            <div className="flex flex-wrap gap-2 mt-2.5">
              {TICKET_CATEGORIES.map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                    category === c
                      ? "bg-primary text-primary-foreground shadow-md scale-[1.02]"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-foreground">Subject <span className="text-destructive">*</span></label>
              <span className={`text-xs tabular-nums ${subject.length > 120 ? "text-destructive" : "text-muted-foreground"}`}>
                {subject.length}/120
              </span>
            </div>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value.slice(0, 120))}
              placeholder="Brief description of your issue"
              className="h-11"
            />
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-foreground">Description <span className="text-destructive">*</span></label>
              <span className={`text-xs tabular-nums ${description.length > 2000 ? "text-destructive" : "text-muted-foreground"}`}>
                {description.length}/2000
              </span>
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, 2000))}
              placeholder="Tell us more about the issue you are facing. Include any relevant details like dates, amounts, or error messages..."
              rows={5}
              className="flex w-full rounded-lg border border-input bg-background px-4 py-3 text-sm min-h-[140px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors placeholder:text-muted-foreground/60"
            />
          </div>

          {/* File Attachment - Drag & Drop */}
          <div>
            <label className="text-sm font-medium text-foreground">Attachment <span className="text-muted-foreground font-normal text-xs">(optional)</span></label>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-2 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 ${
                dragOver
                  ? "border-primary bg-primary/5 scale-[1.01]"
                  : attachment
                    ? "border-emerald-300 bg-emerald-50/50"
                    : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/30"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={e => setAttachment(e.target.files?.[0] || null)}
              />
              {attachment ? (
                <div className="flex items-center gap-4">
                  {attachmentPreview ? (
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden border bg-white shrink-0">
                      <img src={attachmentPreview} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                      <FileIcon className="h-6 w-6 text-red-400" />
                    </div>
                  )}
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{attachment.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(attachment.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); setAttachment(null); setAttachmentPreview(null) }}
                    aria-label="Remove attachment"
                    className="p-1.5 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="mx-auto w-10 h-10 rounded-full bg-muted/60 flex items-center justify-center">
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Drop a file here or <span className="text-primary">browse</span>
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1">JPG, PNG, PDF up to 5 MB</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="text-sm font-medium text-foreground">Priority</label>
            <div className="flex gap-2 mt-2.5">
              {([
                { value: "low" as const, label: "Low", color: "text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100", activeColor: "bg-emerald-600 text-white border-emerald-600 shadow-md" },
                { value: "normal" as const, label: "Normal", color: "text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100", activeColor: "bg-blue-600 text-white border-blue-600 shadow-md" },
                { value: "high" as const, label: "High", color: "text-red-600 bg-red-50 border-red-200 hover:bg-red-100", activeColor: "bg-red-600 text-white border-red-600 shadow-md" },
              ]).map(p => (
                <button
                  key={p.value}
                  onClick={() => setPriority(p.value)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border transition-all duration-200 ${
                    priority === p.value ? p.activeColor : p.color
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={submitting || !subject.trim() || !description.trim()}
            className="w-full h-12 text-base font-semibold shadow-sm gap-2"
          >
            {submitting ? (
              <><RefreshCw className="h-4 w-4 animate-spin" /> Submitting...</>
            ) : (
              <><Send className="h-4 w-4" /> Submit Ticket</>
            )}
          </Button>
        </div>
      )}

      {/* ============ SUCCESS STATE ============ */}
      {view === "new" && submitted && (
        <Card className="border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white overflow-hidden">
          <CardContent className="py-12 text-center relative">
            {/* Animated checkmark */}
            <div className="mx-auto w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-5 animate-[bounceIn_0.5s_ease-out]">
              <svg className="w-10 h-10 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path className="animate-[drawCheck_0.4s_0.3s_ease-out_both]" d="M5 13l4 4L19 7" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: "drawCheck 0.4s 0.3s ease-out forwards" }} />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-emerald-800">Ticket Submitted Successfully!</h3>
            <div className="mt-4 inline-flex items-center gap-2 bg-white rounded-xl border border-emerald-200 px-5 py-3 shadow-sm">
              <Ticket className="h-4 w-4 text-emerald-600" />
              <span className="font-mono text-lg font-bold tracking-wider text-emerald-700">{submitted}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-5">
              We&apos;ll respond within <strong>1-2 business days</strong>.
            </p>
            <p className="text-xs text-muted-foreground mt-2">Redirecting to your tickets...</p>
            {/* Progress bar */}
            <div className="mt-5 mx-auto w-48 h-1 bg-emerald-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full animate-[fillBar_3s_linear]" style={{ animation: "fillBar 3s linear forwards" }} />
            </div>
            <style>{`
              @keyframes drawCheck { to { stroke-dashoffset: 0; } }
              @keyframes bounceIn { 0% { transform: scale(0); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
              @keyframes fillBar { from { width: 0%; } to { width: 100%; } }
            `}</style>
          </CardContent>
        </Card>
      )}

      {/* ============ TICKET LIST ============ */}
      {view === "list" && (
        <>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-xl border bg-card p-4 animate-pulse">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded w-3/4" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                    <div className="h-6 w-20 bg-muted rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="py-16 text-center">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
                  <Inbox className="h-8 w-8 text-muted-foreground/40" />
                </div>
                <h3 className="font-semibold text-lg">No tickets yet</h3>
                <p className="text-sm text-muted-foreground mt-1.5 max-w-xs mx-auto">
                  Need help with something? Create a support ticket and our team will assist you.
                </p>
                <Button onClick={() => setView("new")} variant="outline" className="mt-5 gap-2">
                  <Plus className="h-4 w-4" /> Create your first ticket
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {tickets.map((t: any) => (
                <div
                  key={t.id}
                  onClick={() => openTicket(t)}
                  className="group relative rounded-xl border bg-card p-4 cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/20"
                >
                  <div className="flex items-start gap-3.5">
                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      t.status === "open" ? "bg-amber-100" : t.status === "in_progress" ? "bg-blue-100" : t.status === "resolved" ? "bg-emerald-100" : "bg-gray-100"
                    }`}>
                      <MessageCircle className={`h-5 w-5 ${
                        t.status === "open" ? "text-amber-600" : t.status === "in_progress" ? "text-blue-600" : t.status === "resolved" ? "text-emerald-600" : "text-gray-400"
                      }`} />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono text-[11px] text-muted-foreground/70 tracking-wide">{t.ticket_number}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-medium">{t.category}</Badge>
                      </div>
                      <p className="font-semibold text-sm leading-tight group-hover:text-primary transition-colors">{t.subject}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-muted-foreground">{formatDate(t.created_at)}</span>
                        {t.last_reply_preview && (
                          <>
                            <span className="text-muted-foreground/30">|</span>
                            <span className="text-xs text-muted-foreground/70 truncate">{t.last_reply_preview}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${statusColor(t.status)}`}>
                        {statusIcon(t.status)}
                        {statusLabel(t.status)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-primary/60 transition-colors" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ============ TICKET DETAIL / CHAT ============ */}
      {view === "detail" && selectedTicket && (
        <div className="space-y-0">
          {/* Ticket header card */}
          <Card className="rounded-b-none border-b-0">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-muted-foreground/70 tracking-wide">{selectedTicket.ticket_number}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{selectedTicket.category}</Badge>
                  </div>
                  <h3 className="font-bold text-base leading-snug">{selectedTicket.subject}</h3>
                  <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" />
                    {formatDate(selectedTicket.created_at)}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 ${statusColor(selectedTicket.status)}`}>
                  {statusIcon(selectedTicket.status)}
                  {statusLabel(selectedTicket.status)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Chat area */}
          <div className="border border-t-0 rounded-b-xl bg-gradient-to-b from-muted/20 to-muted/5">
            <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Original message */}
              <div className="flex justify-end">
                <div className="max-w-[85%]">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-3 shadow-sm">
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{selectedTicket.description}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 text-right px-1">
                    You &middot; {formatDate(selectedTicket.created_at)}
                  </p>
                </div>
              </div>

              {/* Replies */}
              {replies.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-xs text-muted-foreground/60">No replies yet. We&apos;ll get back to you soon.</p>
                </div>
              )}

              {replies.map((r: any, i: number) => {
                const { text, url } = extractAttachment(r.message)
                return (
                  <div key={r.id || i} className={`flex ${r.is_admin ? "justify-start" : "justify-end"}`}>
                    <div className="max-w-[85%]">
                      <div className={`rounded-2xl px-4 py-3 shadow-sm ${
                        r.is_admin
                          ? "bg-white border border-border/60 rounded-tl-md"
                          : "bg-primary text-primary-foreground rounded-tr-md"
                      }`}>
                        {text && <p className="text-sm whitespace-pre-wrap leading-relaxed">{text}</p>}
                        {url && (
                          isImageUrl(url) ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                              <div className="relative rounded-lg overflow-hidden border bg-muted/30 max-w-[220px]">
                                <img src={url} alt="Attachment" className="w-full h-auto max-h-[200px] object-cover hover:opacity-90 transition-opacity" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/40 to-transparent p-2">
                                  <span className="text-[10px] text-white font-medium flex items-center gap-1"><Image className="h-3 w-3" /> View full size</span>
                                </div>
                              </div>
                            </a>
                          ) : (
                            <a href={url} target="_blank" rel="noopener noreferrer" className={`mt-2 inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg transition-colors ${
                              r.is_admin ? "bg-muted hover:bg-muted/80 text-foreground" : "bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground"
                            }`}>
                              <FileIcon className="h-3.5 w-3.5" />
                              View PDF Attachment
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )
                        )}
                      </div>
                      <p className={`text-[10px] text-muted-foreground mt-1 px-1 ${r.is_admin ? "text-left" : "text-right"}`}>
                        {r.is_admin ? "AMASI Support" : "You"} &middot; {formatDate(r.created_at)}
                      </p>
                    </div>
                  </div>
                )
              })}
              <div ref={repliesEndRef} />
            </div>

            {/* Reply form */}
            {selectedTicket.status !== "closed" ? (
              <div className="border-t bg-white rounded-b-xl p-3">
                {/* File preview strip */}
                {replyFile && (
                  <div className="mb-2 flex items-center gap-3 bg-muted/40 rounded-lg px-3 py-2">
                    {replyFilePreview ? (
                      <div className="w-10 h-10 rounded-md overflow-hidden border shrink-0">
                        <img src={replyFilePreview} alt="Preview" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                        <FileIcon className="h-4 w-4 text-red-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{replyFile.name}</p>
                      <p className="text-[10px] text-muted-foreground">{(replyFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button
                      onClick={() => { setReplyFile(null); setReplyFilePreview(null) }}
                      aria-label="Remove attachment"
                      className="p-1 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  {/* Paperclip / attach button */}
                  <button
                    onClick={() => replyFileInputRef.current?.click()}
                    aria-label="Attach file"
                    className="flex items-center justify-center h-10 w-10 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                    title="Attach file"
                  >
                    <Paperclip className="h-5 w-5" />
                    <input
                      ref={replyFileInputRef}
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={e => setReplyFile(e.target.files?.[0] || null)}
                    />
                  </button>

                  {/* Text input (textarea for multiline) */}
                  <textarea
                    ref={replyInputRef}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="Type a message..."
                    rows={1}
                    className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors placeholder:text-muted-foreground/50 max-h-32 min-h-[40px]"
                    style={{ height: "auto", minHeight: "40px" }}
                    onInput={e => {
                      const target = e.currentTarget
                      target.style.height = "auto"
                      target.style.height = Math.min(target.scrollHeight, 128) + "px"
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleReply()
                      }
                    }}
                  />

                  {/* Send button */}
                  <Button
                    onClick={handleReply}
                    disabled={sendingReply || (!replyText.trim() && !replyFile)}
                    size="icon"
                    className="h-10 w-10 rounded-lg shrink-0 shadow-sm"
                  >
                    {sendingReply ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
                  Press Enter to send, Shift+Enter for new line
                </p>
              </div>
            ) : (
              <div className="border-t bg-muted/30 rounded-b-xl p-4 text-center space-y-2">
                <p className="text-sm text-muted-foreground">This ticket is closed.</p>
                <Button variant="outline" size="sm" onClick={async () => {
                  try {
                    await fetch(`/api/tickets/${selectedTicket.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "open" }),
                    })
                    setSelectedTicket({ ...selectedTicket, status: "open" })
                    toast.success("Ticket reopened")
                  } catch { toast.error("Failed to reopen") }
                }}>
                  Reopen Ticket
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ===================== MEMBER UPGRADE TAB =====================

function MemberUpgradeTab({ member, memberType, amasiNum }: { member: any; memberType: string; amasiNum: string | number }) {
  const [asiNumber, setAsiNumber] = useState("")
  const [asiState, setAsiState] = useState("")
  const [asiCertFile, setAsiCertFile] = useState<File | null>(null)
  const [asiEmailFile, setAsiEmailFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [upgrades, setUpgrades] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<{ success: boolean; message: string; autoApproved?: boolean } | null>(null)

  const isAlreadyLM = memberType.toUpperCase() === "LM" || memberType.toUpperCase() === "LIFE MEMBER"

  // Fetch existing upgrade requests
  useEffect(() => {
    if (!member?.email) return
    setLoading(true)
    fetch(`/api/members/upgrade?email=${encodeURIComponent(member.email)}`)
      .then(r => r.json())
      .then(d => setUpgrades(d.data || []))
      .catch(() => setUpgrades([]))
      .finally(() => setLoading(false))
  }, [member?.email, result])

  const hasPending = upgrades.some(u => u.status === "pending" || u.status === "pending_review")

  const handleSubmit = async () => {
    if (!asiNumber.trim()) { toast.error("ASI Membership Number is required"); return }
    if (!asiCertFile) { toast.error("Please upload your ASI certificate"); return }

    setSubmitting(true)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append("data", JSON.stringify({
        memberId: member._id || member.id,
        amasiNumber: member.amasi_number || member.membership_no,
        memberName: member.name || [member.first_name, member.last_name].filter(Boolean).join(" "),
        memberEmail: member.email,
        asiMembershipNo: asiNumber.trim(),
        asiState: asiState || null,
      }))
      formData.append("asi_certificate", asiCertFile)
      if (asiEmailFile) formData.append("asi_email_proof", asiEmailFile)

      const res = await fetch("/api/members/upgrade", { method: "POST", body: formData })
      const data = await res.json()

      if (data.status) {
        setResult({ success: true, message: data.message, autoApproved: data.auto_approved })
        setAsiNumber("")
        setAsiState("")
        setAsiCertFile(null)
        setAsiEmailFile(null)
        if (data.auto_approved) {
          toast.success("Membership upgraded to Life Member!")
        } else {
          toast.success("Upgrade request submitted for review")
        }
      } else {
        setResult({ success: false, message: data.message })
        toast.error(data.message)
      }
    } catch {
      setResult({ success: false, message: "Network error. Please try again." })
      toast.error("Failed to submit upgrade request")
    } finally {
      setSubmitting(false)
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "approved": return "bg-green-100 text-green-700"
      case "rejected": return "bg-red-100 text-red-700"
      case "pending_review": return "bg-amber-100 text-amber-700"
      default: return "bg-gray-100 text-gray-600"
    }
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case "approved": return "Approved"
      case "rejected": return "Rejected"
      case "pending_review": return "Pending Review"
      default: return status?.charAt(0).toUpperCase() + status?.slice(1)
    }
  }

  if (isAlreadyLM) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Upgrade to Life Member</h2>
          <p className="text-muted-foreground text-sm mt-1">Manage your membership upgrade</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold text-green-700">You are already a Life Member</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Your membership type is <strong>{memberType}</strong> (AMASI #{amasiNum}).
              No upgrade is needed.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Upgrade to Life Member</h2>
        <p className="text-muted-foreground text-sm mt-1">
          As an ALM member, you can upgrade to Life Member (LM) by providing your ASI membership details
        </p>
      </div>

      {/* Requirements info */}
      <Card className="border-blue-200 bg-blue-50/30">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Requirements for Upgrade</h4>
              <ul className="text-xs text-muted-foreground mt-2 space-y-1.5">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  ASI (Association of Surgeons of India) Membership Number
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  ASI State Chapter
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  ASI Membership Certificate (upload)
                </li>
                <li className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  Email confirmation from ASI (optional, speeds up approval)
                </li>
              </ul>
              <p className="text-xs text-blue-600 font-medium mt-3">
                If all details check out, your upgrade may be auto-approved instantly.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Success result */}
      {result?.success && (
        <Card className={result.autoApproved ? "border-green-300 bg-green-50/50" : "border-amber-300 bg-amber-50/50"}>
          <CardContent className="py-8 text-center">
            <div className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-4 ${result.autoApproved ? "bg-green-100" : "bg-amber-100"}`}>
              {result.autoApproved ? <CheckCircle className="h-7 w-7 text-green-600" /> : <Clock className="h-7 w-7 text-amber-600" />}
            </div>
            <h3 className={`text-lg font-bold ${result.autoApproved ? "text-green-700" : "text-amber-700"}`}>
              {result.autoApproved ? "Upgrade Approved!" : "Request Submitted"}
            </h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">{result.message}</p>
            {result.autoApproved && (
              <p className="text-xs text-green-600 font-medium mt-3">
                Please log out and log back in to see your updated membership type.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Upgrade form */}
      {!hasPending && !result?.success && (
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center gap-2 mb-2">
              <ArrowUpCircle className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Submit Upgrade Request</h3>
            </div>

            <div>
              <label className="text-sm font-medium">ASI Membership Number <span className="text-destructive">*</span></label>
              <Input
                value={asiNumber}
                onChange={e => setAsiNumber(e.target.value)}
                placeholder="e.g., ASI/12345 or L-12345"
                className="mt-1.5"
              />
            </div>

            <div className="relative z-10">
              <label className="text-sm font-medium">ASI State Chapter</label>
              <select
                value={asiState}
                onChange={e => setAsiState(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1.5 appearance-auto"
              >
                <option value="">Select state...</option>
                {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">ASI Certificate <span className="text-destructive">*</span></label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">Upload your ASI membership certificate (PDF, JPG, PNG)</p>
              <div className="relative">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={e => setAsiCertFile(e.target.files?.[0] || null)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium"
                />
              </div>
              {asiCertFile && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> {asiCertFile.name}
                </p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium">ASI Email Confirmation <span className="text-muted-foreground font-normal">(optional)</span></label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">Screenshot or PDF of ASI membership confirmation email</p>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={e => setAsiEmailFile(e.target.files?.[0] || null)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium"
              />
              {asiEmailFile && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> {asiEmailFile.name}
                </p>
              )}
            </div>

            {result?.success === false && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 rounded-lg p-3">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {result.message}
              </div>
            )}

            <Button
              className="w-full h-11 font-semibold"
              onClick={handleSubmit}
              disabled={submitting || !asiNumber.trim() || !asiCertFile}
            >
              {submitting ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Submitting...</>
              ) : (
                <><ArrowUpCircle className="h-4 w-4 mr-2" /> Submit Upgrade Request</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Existing upgrade requests */}
      <div>
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">Upgrade History</h3>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
        ) : upgrades.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">No upgrade requests yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {upgrades.map((u: any) => (
              <Card key={u.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">ALM to LM Upgrade</p>
                        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusBadge(u.status)}`}>
                          {statusLabel(u.status)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        ASI #{u.asi_membership_no}
                        {u.asi_state && <> &middot; {u.asi_state}</>}
                        {" "}&middot; {formatDate(u.created_at)}
                      </p>
                      {u.ai_confidence && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          AI confidence: <span className={`font-medium ${u.ai_confidence === "high" ? "text-green-600" : u.ai_confidence === "medium" ? "text-amber-600" : "text-red-600"}`}>{u.ai_confidence}</span>
                          {u.ai_verified && <span className="text-green-600 ml-1">(verified)</span>}
                        </p>
                      )}
                      {u.status === "rejected" && u.review_notes && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-xs font-semibold text-red-700 mb-1">Rejection Reason:</p>
                          <p className="text-xs text-red-600">{u.review_notes}</p>
                        </div>
                      )}
                      {u.status !== "rejected" && u.review_notes && (
                        <p className="text-xs mt-2 p-2 bg-muted/50 rounded-lg">{u.review_notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {u.asi_certificate_url && (
                        <a href={u.asi_certificate_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                          <Eye className="h-3 w-3" /> Cert
                        </a>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function MemberPortalPage() {
  return (
    <>
      <AdminBackLink />
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center animate-pulse">
              <span className="text-primary font-bold text-lg">A</span>
            </div>
            <p className="text-sm text-muted-foreground">Loading Member Portal...</p>
          </div>
        </div>
      }>
        <MemberPortalContent />
      </Suspense>
      <HelpButton />
    </>
  )
}
