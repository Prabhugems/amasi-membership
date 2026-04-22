# Session Close-Out — April 21-22, 2026

## Summary

Two-day intensive session covering the AMASI Membership Portal. 30 commits, 50+ bugs fixed, 3 major features built, 1 critical payment-loss vulnerability identified and resolved.

---

## 1. Features Built

### Incomplete Applications System
- Draft persistence: application state saved to DB after every step
- Resume flow: users can resume stuck applications via OTP verification
- Admin dashboard: new "Incomplete Applications" sidebar page with stats, filters, actions
- Hourly cron job: marks stale drafts, sends reminders, expires unpaid, holds paid-but-stuck
- Refund flow: admin can initiate Razorpay refunds for payment_on_hold applications

### Document Storage
- Documents now uploaded to Supabase Storage during OCR processing
- Admin can view actual document images in the pending approvals page
- Profile photos copied to member records on approval

### Zoho Campaigns Integration
- OAuth2 flow with auto-refresh tokens
- 1,231 members synced to AMASI MEMBERS list
- Auto-add new approved members to Zoho list
- Email campaigns page for bulk outreach

### Razorpay Route
- ₹100 processing fee auto-transfer to Events360 (acc_SYV3ZpQvinGqOW)
- Order-level transfer (Razorpay recommended approach)
- Transfer status logged in payment records

### Email Campaigns Page
- Admin can send profile update campaigns (100 per batch)
- Track sent/failed counts, recipient list, AMASI number range

### Sentry Error Monitoring
- Client/server/edge instrumented
- Payment verify, application submit, OCR, and approve routes monitored
- Global error boundary with user-friendly fallback
- Test route at /api/sentry-test verified working

---

## 2. Critical Payment Integrity Fix (4-Phase)

### The Problem
Users paid ₹4,230 but their application was never submitted. Root cause: 4 compounding bugs.

### Root Cause Analysis
1. **JWT expires after 1 hour** — users taking longer had all draft saves silently fail (401 swallowed by catch{})
2. **First saveDraftToServer always no-ops** — stale closure on emailVerified state
3. **409 conflict permanently poisons session** — one conflict = all future saves dead
4. **has_verified_payment never set by save-draft** — resume flow didn't detect existing payment, charged user again

### The Fix
- **Phase 1**: JWT auto-refresh every 45 min with 4-hour hard cap
- **Phase 2**: Resilient saveDraftToServer — handles 401 (refresh + retry), 409 (sync serverUpdatedAt + retry), returns {ok, error}
- **Phase 3**: Blocking pre-payment checkpoint — form data MUST reach server before Razorpay opens
- **Phase 4**: Post-payment blocking save (8s cap), has_verified_payment set immediately on payment save

---

## 3. Orphaned Payments — All Resolved

| # | Name | Email | Amount | Resolution |
|---|------|-------|--------|------------|
| 1 | KUMAR KAUSHIK | krkaushik22@gmail.com | ₹4,230 | Contacted — awaiting re-submission |
| 2 | Chandra Nath Saha | chandranathsaha902@gmail.com | ₹4,230 | Approved as #18257 |
| 3 | SURBHI PATIDAR | patisurbhi@gmail.com | ₹4,230 | Approved as #18258 |
| 4 | VINEETH KUMAR R K | vineeth.kumar.rk@gmail.com | ₹4,230 | Approved as #18256 |
| 5 | Dr. Rajesh Kumar | prabhu3693gems@gmail.com | ₹4,230 | Test payment |
| 6 | Vinitha R | sharansh9081@gmail.com | ₹4,230 | Refunded |

**Total: ₹25,380 — all accounted for.**

---

## 4. Data Operations

- Imported 99 new members from old AMASI MySQL dump
- Cleaned 1,760 placeholder emails → noemail-{amasi}@noemail.amasi.org
- Deleted 38 dead "Unknown" records with no data
- Fixed 37 numeric state IDs → proper state names
- Fixed 1 null name (#15809)
- AMASI sequence updated to 18255
- NMC verification run for 3 applicants (Vineeth verified, Chandra Nath verified, Surbhi not in NMC)

---

## 5. Bugs Fixed (50+)

### Application Form (15)
- Fields disappearing after typing (conditional rendering)
- DOB min date missing, OCR range too narrow
- lastName blocking single-name applicants
- Ctrl+Enter bypassing validation
- mciCouncilState missing from inline form
- ILM fee mismatch ($400 vs $300)
- Progress tracker missing mciCouncilState
- Phone summary hardcoded +91
- Profile photo rejected by OCR (missing buildPrompt branch)
- Blank page fallback on invalid phase
- Error fields glow border for visibility
- Duplicate check message unclear
- Review summary fields disappearing (useRef in conditional)
- Upload canContinue guard not checking restored uploads
- OTP attempts remaining off by one

### Payment Flow (8)
- Payment never linked to application (application_id null)
- Orphaned payment detection and recovery
- 3x submit retry after payment
- Draft save before payment (blocking checkpoint)
- JWT auto-refresh for long sessions
- ILM transfer skip, fee_breakdown fix
- Currency validation server-side
- Route transfer moved to order creation

### Admin Dashboard (10)
- Pending page mutations missing onError handlers
- Profile photo uses doc.url not doc.fileUrl
- Tab badge counts wrong for non-active tabs
- Members page key={amasi_number} null
- Approve route uses MAX+1 instead of sequence
- Approve route member rollback on failure
- Reject/clarify guard on approved applications
- Clarification missing reviewed_at
- Upgrades subtitle wrong
- Member name empty fallback

### Incomplete Applications (10)
- Cron files deleted before payment guard
- Cron no guard on uncaptured payment delete
- PostgREST .not() syntax wrong — resume never worked
- Refund ignores DB update failure
- Submit deletes all drafts including payment_on_hold
- Badge excludes refund_initiated
- Permanent spinner on refund cards
- Resume accepts stuck (should only be payment_on_hold)
- Optimistic lock bypass when lastUpdatedAt omitted
- Orphaned drafts cleanup

### Resubmit Flow (5)
- 403 on every resubmit (missing email)
- Status API missing fields for resubmit form
- No AI re-scoring after resubmit
- Silent file upload failure
- No OTP auth on resubmit

### AI Scoring (3)
- Name scoring reads wrong field (name vs full_name)
- ILM penalized by NMC/MCI checks
- Duplicate check uses wrong column (mobile vs phone)

### Security (2)
- No auth on /api/ocr endpoint
- Resubmit no authentication

---

## 6. Known Unknowns / What to Watch

1. **Kumar Kaushik** — contacted but hasn't re-applied yet. Monitor his email for support requests.
2. **Pending tab counts** — still derived from active tab's response, not a separate counts query. UX issue, not data loss.
3. **Browser testing** — Playwright couldn't connect during this session. Need to test form end-to-end in a real browser.
4. **Zoho double opt-in** — contacts added via API may need confirmation. Check if the CSV import resolved this.
5. **ZOHO_DEFAULT_LIST_KEY** — needs to be set in Vercel env vars for auto-add on approval to work.
6. **Sentry org/project** — configured as "amasi"/"amasi-membership" in next.config.ts. May need adjustment to match actual Sentry org name.
7. **Razorpay Route** — working for order-level transfers. Monitor for any transfer failures in Sentry/Vercel logs.
8. **OCR auth gate** — added getMemberSession check. May block legitimate users if their session expired during upload. Monitor Sentry for 401s on /api/ocr.

---

## 7. Commit Log

See `/docs/commits-2026-04-22.txt` for full 30-commit log.

---

*Session conducted April 21-22, 2026. All changes deployed to production via Vercel.*
