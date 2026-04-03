"use client"

import { useState, useRef, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import {
  Mail, RefreshCw, CreditCard, Award, UserPen, Clock, LogOut,
  Shield, ChevronRight, LayoutDashboard, FileText, Upload, ShieldCheck,
  User, MapPin, Phone, GraduationCap, CheckCircle,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { toast } from "sonner"
import { formatDate, getInitials } from "@/lib/utils"
import Link from "next/link"

type Phase = "login" | "otp" | "dashboard"
type Tab = "overview" | "card" | "certificate" | "profile" | "documents"

function MemberPortalContent() {
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<Phase>("login")
  const [email, setEmail] = useState("")
  const [member, setMember] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<Tab>("overview")

  // OTP state
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""])
  const [isSending, setIsSending] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [otpSent, setOtpSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

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

  const handleLogout = () => {
    setPhase("login"); setEmail(""); setMember(null); setDigits(["", "", "", "", "", ""])
    setOtpSent(false); setError(null); setActiveTab("overview"); toast.info("Logged out")
  }

  const maskedEmail = email.replace(/^(.{3})(.*)(@.*)$/, "$1***$3")
  const fullName = member ? [member.first_name, member.last_name].filter(Boolean).join(" ") : ""

  // ===== LOGIN =====
  if (phase === "login") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-3">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-2xl">A</span>
            </div>
            <h1 className="text-3xl font-bold">AMASI</h1>
            <p className="text-muted-foreground">Member Portal — Sign in to access your membership</p>
          </div>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <label className="text-sm font-medium">Email Address</label>
                <div className="relative mt-1.5">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type="email" placeholder="your.email@example.com" value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null) }}
                    onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                    className="pl-10 h-11" disabled={isSending} />
                </div>
              </div>
              {error && <p className="text-sm text-destructive text-center">{error}</p>}
              <Button className="w-full h-11 font-semibold" onClick={handleSendOtp} disabled={isSending || !email.trim()}>
                {isSending ? "Sending OTP..." : "Sign In with OTP"}
              </Button>
            </CardContent>
          </Card>
          <div className="text-center space-y-2">
            <p className="text-xs text-muted-foreground">Not a member yet?</p>
            <a href="/apply" className="text-sm text-primary font-medium hover:underline">Apply for Membership →</a>
          </div>
        </div>
      </div>
    )
  }

  // ===== OTP =====
  if (phase === "otp") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Mail className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Verify Your Email</h1>
            <p className="text-muted-foreground text-sm">Enter the 6-digit code sent to <strong>{maskedEmail}</strong></p>
          </div>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex justify-center gap-2" onPaste={handlePaste}>
                {digits.map((digit, i) => (
                  <Input key={i} ref={(el) => { inputRefs.current[i] = el }} type="text" inputMode="numeric" maxLength={1}
                    value={digit} onChange={(e) => handleDigitChange(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-bold" disabled={isVerifying || isLoading} />
                ))}
              </div>
              {error && <p className="text-sm text-destructive text-center">{error}</p>}
              {(isVerifying || isLoading) && <p className="text-sm text-muted-foreground text-center">{isVerifying ? "Verifying..." : "Loading profile..."}</p>}
              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={handleSendOtp} disabled={isSending || cooldown > 0}>
                  <RefreshCw className="h-4 w-4 mr-1.5" />{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className="text-center">
            <Button variant="link" onClick={() => { setPhase("login"); setDigits(["","","","","",""]); setError(null) }} className="text-muted-foreground">
              ← Use a different email
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

    const sidebarItems: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
      { id: "overview", label: "Dashboard", icon: LayoutDashboard },
      { id: "card", label: "Membership Card", icon: CreditCard },
      { id: "certificate", label: "Certificate", icon: Award },
      { id: "profile", label: "Edit Profile", icon: UserPen },
      { id: "documents", label: "Documents", icon: Upload },
    ]

    return (
      <div className="min-h-screen flex">
        {/* Member Sidebar */}
        <aside className="w-64 border-r bg-card flex flex-col shrink-0">
          {/* Header */}
          <div className="h-16 flex items-center gap-3 border-b px-5">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">A</span>
            </div>
            <div>
              <h1 className="font-semibold text-sm">AMASI</h1>
              <p className="text-[10px] text-muted-foreground">Member Portal</p>
            </div>
          </div>

          {/* Profile summary */}
          <div className="p-4 border-b">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={member.profile_photo || member.profile} />
                <AvatarFallback className="text-xs bg-primary/10 text-primary">{getInitials(fullName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">Dr. {fullName}</p>
                <p className="text-[11px] text-muted-foreground font-mono">#{amasiNum}</p>
              </div>
            </div>
            <Badge variant="secondary" className="mt-2 text-xs">{memberType}</Badge>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-3 space-y-1">
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === item.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            ))}
          </nav>

          {/* Footer */}
          <div className="p-3 border-t space-y-2">
            <a href="/" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-accent">
              <ShieldCheck className="h-3.5 w-3.5" /> Admin Dashboard
            </a>
            <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-destructive transition-colors rounded-lg hover:bg-destructive/5">
              <LogOut className="h-3.5 w-3.5" /> Logout
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8 overflow-auto">
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="max-w-3xl space-y-6">
              <h2 className="text-2xl font-bold">Welcome, Dr. {member.first_name}!</h2>

              {/* Profile Card */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-start gap-5">
                    <Avatar className="h-20 w-20 ring-4 ring-muted">
                      <AvatarImage src={member.profile_photo || member.profile} />
                      <AvatarFallback className="text-xl bg-primary/10 text-primary">{getInitials(fullName)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-2">
                      <h3 className="text-xl font-bold">Dr. {fullName}</h3>
                      <div className="flex flex-wrap gap-2">
                        <Badge>{memberType}</Badge>
                        <Badge variant="outline" className="font-mono">#{amasiNum}</Badge>
                        {member.zone && <Badge variant="secondary">{member.zone}</Badge>}
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" />{member.email}</div>
                        <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" />{member.mobile || member.phone}</div>
                        {member.state && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" />{[member.city, member.state].filter(Boolean).join(", ")}</div>}
                        {member.pg_degree && <div className="flex items-center gap-2"><GraduationCap className="h-3.5 w-3.5" />{member.pg_degree}</div>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <div className="grid gap-3 sm:grid-cols-3">
                <button onClick={() => setActiveTab("card")} className="group p-5 rounded-xl border hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left">
                  <div className="p-2.5 rounded-lg bg-blue-100 text-blue-600 w-fit mb-3"><CreditCard className="h-5 w-5" /></div>
                  <p className="font-semibold text-sm">Membership Card</p>
                  <p className="text-xs text-muted-foreground mt-1">View & download your digital card</p>
                </button>
                <button onClick={() => setActiveTab("certificate")} className="group p-5 rounded-xl border hover:border-amber-300 hover:bg-amber-50/50 transition-all text-left">
                  <div className="p-2.5 rounded-lg bg-amber-100 text-amber-600 w-fit mb-3"><Award className="h-5 w-5" /></div>
                  <p className="font-semibold text-sm">Certificate</p>
                  <p className="text-xs text-muted-foreground mt-1">Download membership certificate</p>
                </button>
                <button onClick={() => setActiveTab("profile")} className="group p-5 rounded-xl border hover:border-green-300 hover:bg-green-50/50 transition-all text-left">
                  <div className="p-2.5 rounded-lg bg-green-100 text-green-600 w-fit mb-3"><UserPen className="h-5 w-5" /></div>
                  <p className="font-semibold text-sm">Edit Profile</p>
                  <p className="text-xs text-muted-foreground mt-1">Update your details & documents</p>
                </button>
              </div>

              {/* Verification Status */}
              <Card>
                <CardContent className="p-5">
                  <h4 className="font-semibold text-sm mb-3">Verification Status</h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex items-center gap-2 text-sm">
                      {member.mci_council_number ? (
                        <>{member.mci_certificate ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Clock className="h-4 w-4 text-blue-500" />}</>
                      ) : <Clock className="h-4 w-4 text-muted-foreground" />}
                      <span>MCI: {member.mci_council_number || "Not provided"}</span>
                      {member.mci_certificate && <Badge variant="outline" className="text-[10px] text-green-600 border-green-200">Verified</Badge>}
                      {member.mci_council_number && !member.mci_certificate && <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200">On record</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {member.asi_membership_no ? (
                        <>{member.asi_member_certificate ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Clock className="h-4 w-4 text-blue-500" />}</>
                      ) : <Clock className="h-4 w-4 text-muted-foreground" />}
                      <span>ASI: {member.asi_membership_no || "Not provided"}</span>
                      {member.asi_member_certificate && <Badge variant="outline" className="text-[10px] text-green-600 border-green-200">Verified</Badge>}
                      {member.asi_membership_no && !member.asi_member_certificate && <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200">On record</Badge>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Card Tab */}
          {activeTab === "card" && (
            <div className="max-w-2xl space-y-6">
              <h2 className="text-2xl font-bold">Membership Card</h2>
              <p className="text-muted-foreground">View and download your digital AMASI membership card</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <a href={`/card?id=${encodeURIComponent(member.email)}&direct=1`} target="_blank"
                  className="p-6 rounded-xl border-2 border-dashed hover:border-primary/40 hover:bg-primary/5 transition-all text-center">
                  <CreditCard className="h-10 w-10 text-primary mx-auto mb-3" />
                  <p className="font-semibold">View & Download Card</p>
                  <p className="text-xs text-muted-foreground mt-1">Opens in a new tab with download option</p>
                </a>
                <a href={`/verify?id=${amasiNum}`} target="_blank"
                  className="p-6 rounded-xl border-2 border-dashed hover:border-green-400 hover:bg-green-50 transition-all text-center">
                  <ShieldCheck className="h-10 w-10 text-green-600 mx-auto mb-3" />
                  <p className="font-semibold">Verify Membership</p>
                  <p className="text-xs text-muted-foreground mt-1">Public verification page with QR code</p>
                </a>
              </div>
            </div>
          )}

          {/* Certificate Tab */}
          {activeTab === "certificate" && (
            <div className="max-w-2xl space-y-6">
              <h2 className="text-2xl font-bold">Membership Certificate</h2>
              <p className="text-muted-foreground">Download your official AMASI membership certificate</p>
              <a href={`/member/certificate?id=${amasiNum}`} target="_blank"
                className="block p-8 rounded-xl border-2 border-dashed hover:border-amber-400 hover:bg-amber-50 transition-all text-center">
                <Award className="h-12 w-12 text-amber-600 mx-auto mb-3" />
                <p className="font-semibold text-lg">Download Certificate</p>
                <p className="text-sm text-muted-foreground mt-1">Opens certificate with download & print options</p>
                <p className="text-xs text-muted-foreground mt-2">AMASI #{amasiNum} — Signed by current President & Secretary</p>
              </a>
            </div>
          )}

          {/* Profile Tab */}
          {activeTab === "profile" && (
            <div className="max-w-2xl space-y-6">
              <h2 className="text-2xl font-bold">Edit Profile</h2>
              <p className="text-muted-foreground">Update your personal details, education, and documents</p>
              <a href={`/profile?q=${encodeURIComponent(member.email)}&admin=1`} target="_blank"
                className="block p-8 rounded-xl border-2 border-dashed hover:border-green-400 hover:bg-green-50 transition-all text-center">
                <UserPen className="h-12 w-12 text-green-600 mx-auto mb-3" />
                <p className="font-semibold text-lg">Open Profile Editor</p>
                <p className="text-sm text-muted-foreground mt-1">Edit your details, upload documents, and update your photo</p>
              </a>
            </div>
          )}

          {/* Documents Tab */}
          {activeTab === "documents" && (
            <div className="max-w-2xl space-y-4">
              <h2 className="text-2xl font-bold">My Documents</h2>
              <p className="text-muted-foreground text-sm">Upload or view your membership documents</p>
              <div className="grid gap-3">
                {[
                  { label: "Profile Photo", url: member.profile_photo, key: "photo", required: true },
                  { label: "MCI Certificate", url: member.mci_certificate, key: "mci", required: true },
                  { label: "PG Degree Certificate", url: member.pg_degree_certificate, key: "pg", required: true },
                  { label: "MBBS Degree", url: member.mbbs_degree_certificate, key: "mbbs", required: false },
                  { label: "ASI Certificate", url: member.asi_member_certificate, key: "asi", required: memberType === "Life Member" || memberType === "LM" },
                  { label: "Active License", url: member.active_license, key: "license", required: false },
                  { label: "HOD Letter", url: member.letter_hod, key: "hod", required: false },
                ].filter(doc => doc.required || doc.url).map((doc) => (
                  <div key={doc.key} className="flex items-center justify-between p-4 rounded-xl border">
                    <div className="flex items-center gap-3">
                      {doc.url ? <CheckCircle className="h-5 w-5 text-green-500" /> : <Clock className="h-5 w-5 text-muted-foreground" />}
                      <div>
                        <p className="text-sm font-medium">{doc.label}</p>
                        <p className="text-xs text-muted-foreground">{doc.url ? "Uploaded" : "Not uploaded"}</p>
                      </div>
                    </div>
                    {doc.url ? (
                      <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">View</a>
                    ) : (
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => { setActiveTab("profile"); toast.info("Upload documents from the Edit Profile page") }}>
                        Upload
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    )
  }

  return null
}

export default function MemberPortalPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p>Loading...</p></div>}>
      <MemberPortalContent />
    </Suspense>
  )
}
