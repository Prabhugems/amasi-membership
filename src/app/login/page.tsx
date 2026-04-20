"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Lock, Mail, Loader2, ShieldCheck, Eye, EyeOff, KeyRound } from "lucide-react"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // 2FA state
  const [needs2fa, setNeeds2fa] = useState(false)
  const [twoFaEmail, setTwoFaEmail] = useState("")
  const [totpCode, setTotpCode] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Invalid credentials")
        return
      }

      // If 2FA is required, switch to TOTP input
      if (data.requires2fa) {
        setTwoFaEmail(data.email)
        setNeeds2fa(true)
        setTotpCode("")
        return
      }

      const redirect = searchParams.get("redirect") || "/"
      router.push(redirect)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/totp/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: twoFaEmail, code: totpCode }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Invalid code")
        return
      }

      const redirect = searchParams.get("redirect") || "/"
      router.push(redirect)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-muted/30 via-background to-muted/50 px-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center space-y-4 pb-2">
          {/* AMASI Logo Block */}
          <div className="flex flex-col items-center gap-2">
            <div className="h-14 w-14 rounded-xl bg-emerald-600 flex items-center justify-center text-white text-2xl font-bold shadow-md">
              A
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">AMASI</h1>
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1 mt-0.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Admin Portal
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {needs2fa ? (
            /* ---------- 2FA TOTP step ---------- */
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              <div className="text-center space-y-1 pb-2">
                <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center mx-auto">
                  <KeyRound className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="text-sm font-medium">Two-Factor Authentication</p>
                <p className="text-xs text-muted-foreground">
                  Enter the 6-digit code from your authenticator app
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="totp-code">Verification Code</Label>
                <Input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  disabled={loading}
                />
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full h-11 font-semibold"
                disabled={loading || totpCode.length !== 6}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify"
                )}
              </Button>

              <button
                type="button"
                onClick={() => {
                  setNeeds2fa(false)
                  setTotpCode("")
                  setError("")
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                &larr; Back to login
              </button>
            </form>
          ) : (
            /* ---------- Normal login form ---------- */
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@amasi.org"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                    required
                    autoComplete="email"
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 pr-10"
                    required
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              {/* Submit */}
              <Button type="submit" className="w-full h-11 font-semibold" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          )}

          {/* Back to website */}
          <div className="mt-6 text-center">
            <a
              href="https://www.amasi.org"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              &larr; Back to website
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
