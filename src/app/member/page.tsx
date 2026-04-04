"use client"

import { useState, useRef, useEffect, Suspense, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import {
  Mail, RefreshCw, CreditCard, Award, UserPen, Clock, LogOut,
  Shield, ChevronRight, LayoutDashboard, FileText, Upload, ShieldCheck,
  User, MapPin, Phone, GraduationCap, CheckCircle, Bell, AlertTriangle,
  Ticket, ArrowRight, Eye, Download, ExternalLink, Calendar, Hash, Star,
  Activity, Lock,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { toast } from "sonner"
import { formatDate, getInitials } from "@/lib/utils"
import Link from "next/link"
import { HelpButton } from "@/components/ui/help-button"

type Phase = "login" | "otp" | "dashboard"
type Tab = "overview" | "card" | "certificate" | "profile" | "documents" | "support"

// Session timeout in milliseconds (15 minutes)
const SESSION_TIMEOUT = 15 * 60 * 1000
const SESSION_WARNING = 13 * 60 * 1000 // warn at 13 min (2 min before timeout)

function MemberPortalContent() {
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<Phase>("login")
  const [email, setEmail] = useState("")
  const [member, setMember] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<Tab>("overview")
  const [showSessionWarning, setShowSessionWarning] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
                <Button className="w-full h-12 font-semibold text-base" onClick={handleSendOtp} disabled={isSending || !email.trim()}>
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

  // ===== DASHBOARD WITH SIDEBAR =====
  if (phase === "dashboard" && member) {
    const memberType = member.application_name || member.membership_type || ""
    const amasiNum = member.membership_no || member.amasi_number
    const profileData = getProfileCompleteness()
    const notifications = getNotifications()

    const sidebarItems: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "card", label: "Membership Card", icon: CreditCard },
      { id: "certificate", label: "Certificate", icon: Award },
      { id: "profile", label: "Edit Profile", icon: UserPen },
      { id: "documents", label: "Documents", icon: Upload },
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
            {sidebarItems.map((item) => (
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
                {activeTab === item.id && <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
              </button>
            ))}
          </nav>

          {/* Footer */}
          <div className="p-3 border-t space-y-1">
            <a href="/" className="flex items-center gap-2.5 px-3.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-xl hover:bg-accent">
              <ShieldCheck className="h-3.5 w-3.5" /> Admin Dashboard
            </a>
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
                      { tab: "profile" as Tab, icon: UserPen, title: "Edit Profile", desc: "Update your details & documents", colors: "hover:border-green-300 hover:bg-green-50/50", iconBg: "bg-green-100 text-green-600" },
                      { tab: "documents" as Tab, icon: Upload, title: "Upload Documents", desc: "Manage your certificates & files", colors: "hover:border-purple-300 hover:bg-purple-50/50", iconBg: "bg-purple-100 text-purple-600" },
                      { tab: "support" as Tab, icon: Ticket, title: "Support Tickets", desc: "Get help from AMASI team", colors: "hover:border-rose-300 hover:bg-rose-50/50", iconBg: "bg-rose-100 text-rose-600" },
                    ].map((action) => (
                      <button key={action.tab} onClick={() => setActiveTab(action.tab)} className={`group p-5 rounded-xl border bg-card transition-all text-left ${action.colors}`}>
                        <div className={`p-2.5 rounded-lg w-fit mb-3 ${action.iconBg}`}><action.icon className="h-5 w-5" /></div>
                        <p className="font-semibold text-sm">{action.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{action.desc}</p>
                      </button>
                    ))}
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
              <div className="max-w-2xl space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Edit Profile</h2>
                  <p className="text-muted-foreground text-sm mt-1">Update your personal details, education, and documents</p>
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

                <a href={`/profile?q=${encodeURIComponent(member.email)}`} target="_blank"
                  className="group block p-10 rounded-2xl border-2 border-dashed hover:border-green-400 hover:bg-green-50 transition-all text-center">
                  <div className="mx-auto w-20 h-20 rounded-2xl bg-green-100 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                    <UserPen className="h-10 w-10 text-green-600" />
                  </div>
                  <p className="font-semibold text-xl">Open Profile Editor</p>
                  <p className="text-sm text-muted-foreground mt-2">Edit your details, upload documents, and update your photo</p>
                  <div className="flex items-center justify-center gap-1.5 text-green-600 text-sm font-medium mt-4">
                    Open Editor <ExternalLink className="h-3.5 w-3.5" />
                  </div>
                </a>
              </div>
            )}

            {/* Documents Tab */}
            {activeTab === "documents" && (
              <div className="max-w-2xl space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">My Documents</h2>
                  <p className="text-muted-foreground text-sm mt-1">Upload or view your membership documents</p>
                </div>
                <div className="grid gap-3">
                  {[
                    { label: "Profile Photo", url: member.profile_photo, key: "photo", required: true, icon: User },
                    { label: "MCI Certificate", url: member.mci_certificate, key: "mci", required: true, icon: FileText },
                    { label: "PG Degree Certificate", url: member.pg_degree_certificate, key: "pg", required: true, icon: GraduationCap },
                    { label: "MBBS Degree", url: member.mbbs_degree_certificate, key: "mbbs", required: false, icon: FileText },
                    { label: "ASI Certificate", url: member.asi_member_certificate, key: "asi", required: memberType === "Life Member" || memberType === "LM", icon: Award },
                    { label: "Active License", url: member.active_license, key: "license", required: false, icon: Shield },
                    { label: "HOD Letter", url: member.letter_hod, key: "hod", required: false, icon: FileText },
                  ].filter(doc => doc.required || doc.url).map((doc) => (
                    <div key={doc.key} className="flex items-center justify-between p-4 rounded-xl border bg-card hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${doc.url ? "bg-green-100" : "bg-muted"}`}>
                          {doc.url ? <CheckCircle className="h-4 w-4 text-green-600" /> : <doc.icon className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{doc.label}</p>
                          <p className="text-xs text-muted-foreground">{doc.url ? "Uploaded" : doc.required ? "Required - Not uploaded" : "Optional - Not uploaded"}</p>
                        </div>
                      </div>
                      {doc.url ? (
                        <a href={doc.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium">
                          <Eye className="h-3.5 w-3.5" /> View
                        </a>
                      ) : (
                        <Button variant="outline" size="sm" className="text-xs" onClick={() => { setActiveTab("profile"); toast.info("Upload documents from the Edit Profile page") }}>
                          <Upload className="h-3 w-3 mr-1" /> Upload
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Support Tab */}
            {activeTab === "support" && (
              <div className="max-w-2xl space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Support</h2>
                  <p className="text-muted-foreground text-sm mt-1">Need help? Reach out to the AMASI team</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-6 text-center">
                      <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mb-4">
                        <Mail className="h-6 w-6 text-blue-600" />
                      </div>
                      <p className="font-semibold">Email Support</p>
                      <p className="text-xs text-muted-foreground mt-1 mb-3">For membership queries and document issues</p>
                      <a href="mailto:admin@amasi.org.in" className="text-sm text-primary font-medium hover:underline">
                        admin@amasi.org.in
                      </a>
                    </CardContent>
                  </Card>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-6 text-center">
                      <div className="mx-auto w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mb-4">
                        <Phone className="h-6 w-6 text-green-600" />
                      </div>
                      <p className="font-semibold">Phone Support</p>
                      <p className="text-xs text-muted-foreground mt-1 mb-3">Available Mon-Sat, 10 AM - 6 PM IST</p>
                      <p className="text-sm text-primary font-medium">Contact via email</p>
                    </CardContent>
                  </Card>
                </div>
                <Card className="bg-muted/50">
                  <CardContent className="p-5">
                    <p className="text-sm text-muted-foreground">
                      For urgent issues related to your membership, certificate, or account access, please email <strong>admin@amasi.org.in</strong> with your AMASI number <strong className="font-mono">#{amasiNum}</strong> in the subject line for faster resolution.
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
          </main>
        </div>
      </div>
    )
  }

  return null
}

export default function MemberPortalPage() {
  return (
    <>
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
