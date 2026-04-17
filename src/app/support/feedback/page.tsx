"use client"

import { useState, useEffect, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, CheckCircle, AlertCircle, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

const RATING_EMOJIS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: "\u{1F621}", label: "Very Dissatisfied" },
  2: { emoji: "\u{1F615}", label: "Dissatisfied" },
  3: { emoji: "\u{1F610}", label: "Neutral" },
  4: { emoji: "\u{1F642}", label: "Satisfied" },
  5: { emoji: "\u{1F60D}", label: "Very Satisfied" },
}

function FeedbackContent() {
  const searchParams = useSearchParams()
  const already = searchParams.get("already") === "1"
  const ratingParam = searchParams.get("rating")
  const token = searchParams.get("token")
  const rating = ratingParam ? parseInt(ratingParam, 10) : null

  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [commentSent, setCommentSent] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)

  // Reset comment state on mount
  useEffect(() => {
    setComment("")
    setCommentSent(false)
    setCommentError(null)
  }, [])

  async function handleSubmitComment() {
    if (!comment.trim() || !token) return
    setSubmitting(true)
    setCommentError(null)
    try {
      const res = await fetch("/api/tickets/csat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, comment: comment.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to submit comment")
      }
      setCommentSent(true)
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  const ratingInfo = rating && rating >= 1 && rating <= 5 ? RATING_EMOJIS[rating] : null

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-4 py-16">
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Support
        </Link>

        <Card className="rounded-xl">
          <CardContent className="p-8 text-center space-y-4">
            {already ? (
              <>
                <div className="mx-auto w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
                  <AlertCircle className="h-8 w-8 text-amber-500" />
                </div>
                <h2 className="text-xl font-semibold">Already Submitted</h2>
                <p className="text-sm text-muted-foreground">
                  You have already submitted feedback for this ticket.
                </p>
                {ratingInfo && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <span className="text-3xl">{ratingInfo.emoji}</span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {ratingInfo.label} ({rating}/5)
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mx-auto w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold text-green-800">
                  Thank you for your feedback!
                </h2>
                {ratingInfo && (
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-4xl">{ratingInfo.emoji}</span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {ratingInfo.label} ({rating}/5)
                    </span>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Your rating has been recorded. It helps us improve our support.
                </p>

                {/* Optional comment form */}
                {token && !commentSent && (
                  <div className="pt-4 border-t space-y-3 text-left">
                    <p className="text-sm font-medium">
                      Want to share more details? (optional)
                    </p>
                    <Textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Tell us more about your experience..."
                      rows={3}
                      maxLength={2000}
                    />
                    {commentError && (
                      <p className="text-xs text-destructive">{commentError}</p>
                    )}
                    <Button
                      onClick={handleSubmitComment}
                      disabled={submitting || !comment.trim()}
                      className="w-full"
                      size="sm"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Submit Comment
                    </Button>
                  </div>
                )}
                {commentSent && (
                  <div className="pt-4 border-t">
                    <p className="text-sm text-green-700 font-medium">
                      Comment submitted. Thank you!
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="pt-2">
              <Button variant="outline" asChild>
                <Link href="/support">Go to Support Center</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function FeedbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <FeedbackContent />
    </Suspense>
  )
}
