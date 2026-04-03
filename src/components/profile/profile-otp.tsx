"use client"

import { useState, useRef, useEffect } from "react"
import { Mail, RefreshCw, ShieldCheck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface ProfileOtpProps {
  email: string
  onVerified: () => void
  onBack: () => void
}

export function ProfileOtp({ email, onVerified, onBack }: ProfileOtpProps) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""])
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Send OTP on mount
  useEffect(() => {
    sendOtp()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const sendOtp = async () => {
    setIsSending(true)
    setError(null)
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (data.status) {
        setSent(true)
        setCooldown(60)
      } else {
        setError(data.message)
      }
    } catch {
      setError("Failed to send OTP. Please try again.")
    } finally {
      setIsSending(false)
    }
  }

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const newDigits = [...digits]
    newDigits[index] = value.slice(-1)
    setDigits(newDigits)

    // Auto-advance to next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-verify when all 6 digits entered
    const code = newDigits.join("")
    if (code.length === 6) {
      verifyOtp(code)
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
    if (pasted.length === 6) {
      setDigits(pasted.split(""))
      verifyOtp(pasted)
    }
  }

  const verifyOtp = async (code: string) => {
    setIsVerifying(true)
    setError(null)
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      })
      const data = await res.json()
      if (data.status) {
        onVerified()
      } else {
        setError(data.message)
        setDigits(["", "", "", "", "", ""])
        inputRefs.current[0]?.focus()
      }
    } catch {
      setError("Verification failed. Please try again.")
    } finally {
      setIsVerifying(false)
    }
  }

  // Mask email: show first 3 chars and domain
  const maskedEmail = email.replace(/^(.{3})(.*)(@.*)$/, "$1***$3")

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="text-center space-y-3">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Verify Your Identity</h2>
        <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mx-auto">
          {sent
            ? <>We sent a 6-digit code to <strong className="text-foreground">{maskedEmail}</strong></>
            : (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Sending verification code...
              </span>
            )
          }
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 pb-6 space-y-5">
          <div className="flex justify-center gap-2.5" onPaste={handlePaste}>
            {digits.map((digit, i) => (
              <Input
                key={i}
                ref={(el) => { inputRefs.current[i] = el }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className={`w-12 h-14 text-center text-xl font-bold rounded-lg transition-all ${digit ? "border-primary ring-1 ring-primary/20" : ""} ${error ? "border-destructive" : ""}`}
                disabled={isVerifying}
              />
            ))}
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-sm text-destructive text-center">{error}</p>
            </div>
          )}

          {isVerifying && (
            <p className="text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
              <span className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Verifying...
            </p>
          )}

          <div className="flex items-center justify-center pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={sendOtp}
              disabled={isSending || cooldown > 0}
              className="text-muted-foreground hover:text-foreground gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSending ? "animate-spin" : ""}`} />
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="text-center">
        <Button variant="link" onClick={onBack} className="text-muted-foreground text-sm">
          Use a different email or phone
        </Button>
      </div>
    </div>
  )
}
