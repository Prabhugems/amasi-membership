import { NextRequest, NextResponse } from "next/server"
import { consumeAutoLoginToken, signToken, MEMBER_COOKIE } from "@/lib/auth"

// /m is the short URL embedded in member-facing emails.
//
//   /m            → 307 to /member (lets recipients tap a short host and
//                   sign in with OTP if they don't have a token, or share
//                   the URL with someone else)
//   /m?t=<token>  → validate single-use auto-login token, set member
//                   session cookie, redirect to /member?tab=documents
//                   (the tab the campaign emails are nudging them toward).
//                   On any token failure (expired, replayed, bad signature)
//                   we fall back to /member?error=<code> instead of a hard
//                   error page — the recipient can still sign in via OTP
//                   and complete what they were trying to do.

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t")

  if (!token) {
    return NextResponse.redirect(new URL("/member", req.url), 307)
  }

  const payload = await consumeAutoLoginToken(token)
  if (!payload) {
    return NextResponse.redirect(new URL("/member?error=link_expired", req.url), 307)
  }

  // Issue a real member session — same shape as the OTP-verify path uses.
  // Short TTL (1h) so the auto-login link doesn't grant a long-lived session;
  // the user re-authenticates if they come back later.
  const sessionToken = await signToken({
    sub: payload.sub,
    email: payload.email,
    amasi_number: payload.amasi_number,
    role: "member",
  }, "1h")

  const res = NextResponse.redirect(new URL("/member?tab=documents", req.url), 307)
  res.cookies.set(MEMBER_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  })
  return res
}
