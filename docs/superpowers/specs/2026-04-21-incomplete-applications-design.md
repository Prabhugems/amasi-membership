# Incomplete Applications: Resume & Admin Management

**Date:** 2026-04-21
**Status:** Approved

## Problem

When a membership application gets stuck at any step (network error, browser crash, payment timeout, etc.), the user loses all progress and must start over. There is no visibility for admins into how many applications are abandoned or stuck, and no mechanism to recover paid-but-incomplete applications.

## Solution Overview

1. **Draft persistence** — save application progress to a `draft_applications` database table after each step
2. **Resume flow** — after OTP verification, detect existing drafts and offer to resume
3. **Admin dashboard** — new "Incomplete Applications" page with visibility into stuck applications
4. **Automated cleanup** — hourly cron job to send reminders, expire stale drafts, and protect paid applications
5. **Refund flow** — admin can initiate Razorpay refunds for paid-but-stuck applications

---

## 1. Database: `draft_applications` Table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID (PK, default gen_random_uuid()) | Primary key |
| `email` | TEXT (UNIQUE, NOT NULL) | Applicant email — one draft per email |
| `phone` | TEXT | Phone number (if collected) |
| `membership_type` | TEXT | LM, ALM, ACM, or ILM |
| `current_step` | INT (1-6) | Step the user is currently on |
| `step_data` | JSONB (default '{}') | All collected data so far |
| `failure_reason` | TEXT (nullable) | Why it got stuck (inferred or explicit) |
| `failure_step` | INT (nullable) | Which step the failure occurred on |
| `status` | TEXT (default 'in_progress') | See status values below |
| `payment_order_id` | TEXT (nullable) | Razorpay order ID if payment initiated |
| `payment_id` | TEXT (nullable) | Razorpay payment ID if payment completed |
| `has_verified_payment` | BOOLEAN (default false) | Whether Razorpay confirmed payment |
| `reminder_sent_at` | TIMESTAMP (nullable) | When reminder email was sent |
| `stale_since` | TIMESTAMP (nullable) | When the draft became inactive |
| `expires_at` | TIMESTAMP (nullable) | Calculated: stale_since + 24 hours |
| `created_at` | TIMESTAMP (default now()) | Draft creation time |
| `updated_at` | TIMESTAMP (default now()) | Last activity — used for staleness detection |

### Status values

```
in_progress → stuck → expired (deleted, no payment)
                    → payment_on_hold (has payment, needs admin)
                         → refund_initiated → refunded (deleted)
                         → resumed → completed (deleted, real application created)
```

- `in_progress` — user is actively working on the application
- `stuck` — no activity for 2+ hours (inferred staleness)
- `payment_on_hold` — stuck but has a verified Razorpay payment; admin must handle
- `resumed` — user resumed the application after being stuck
- `refund_initiated` — admin initiated Razorpay refund (async, takes 5-7 business days)
- `refunded` — Razorpay confirmed refund complete; draft is then deleted
- `completed` — application submitted successfully; draft is then deleted
- `expired` — no payment, 24 hours passed; draft auto-deleted by cron

### Staleness threshold

A draft is marked `stuck` after **2 hours** of inactivity (no `updated_at` change). This gives users enough time to gather documents, read terms, or take breaks without being flagged.

---

## 2. Resume Flow (User Side)

### How it works

```
User visits /apply
  → Step 1: Selects membership type
  → Step 2: Enters email + OTP verification (existing flow)
  → OTP verify endpoint checks draft_applications for this email
      ├─ No draft → Start fresh (current behavior)
      └─ Draft found → Return draft data in OTP verify response
          → Show resume modal:
             ┌─────────────────────────────────────────────────┐
             │  Welcome back!                                   │
             │                                                  │
             │  You have an incomplete application from          │
             │  April 18, 2026.                                 │
             │                                                  │
             │  You were on: Document Upload (Step 3 of 6)      │
             │  Membership Type: Life Member (LM)               │
             │                                                  │
             │  [Resume Application]   [Start Fresh]            │
             └─────────────────────────────────────────────────┘
```

### Resume UX details

- On "Resume", show a brief **loading spinner** ("Restoring your application...")
- Step indicator updates to highlight the resumed step
- Form fields pre-populate from `step_data`
- Show a **toast notification**: "Application restored. You can continue from where you left off."
- For step 3 (documents): already-uploaded documents show as completed with thumbnails; remaining documents show upload buttons
- Previous steps show as completed (green checkmarks) in the step indicator

### "Start Fresh" rules

- **If draft has NO payment** → delete draft + cleanup storage files → start new application
- **If draft HAS a verified payment** → **block "Start Fresh"**. Only show "Resume Application". Display message: "This application has a pending payment. Please resume or contact support."

### Concurrent device handling

- When a user resumes on a new device, the `updated_at` timestamp updates
- If the old device/tab tries to save, it gets a **409 Conflict** (optimistic lock using `updated_at`)
- Old tab shows: "This application is being continued on another device. Please close this tab."

### Save points

| Step | When saved | What's saved |
|------|-----------|-------------|
| Step 1+2 (bundled) | After OTP verified | email, phone, membership_type, otp_verified: true |
| Step 3 | After each document upload | document URLs, OCR data (incremental) |
| Step 4 | On "Next" click | User edits to extracted data |
| Step 5 | After payment initiated | razorpay order_id; after payment verified: payment_id, has_verified_payment |
| Step 6 | On successful submit | Draft deleted, real application created |

### API changes

- **Modified: `POST /api/verify-otp`** — after OTP verification, query `draft_applications` for the verified email. Return `{ verified: true, hasDraft: boolean, draft: { current_step, step_data, membership_type, created_at, has_verified_payment } | null }`.
- **New: `PUT /api/applications/save-draft`** — saves/updates draft data for a step. Requires verified OTP session. Rate limited: 30 requests/15min per IP. Accepts `{ email, current_step, step_data, payment_order_id? }`. Uses optimistic locking via `updated_at` — returns 409 if stale.
- **Modified: `POST /api/applications/submit`** — on successful submission, delete draft record from `draft_applications` and clean up any intermediate storage.

---

## 3. Admin: Incomplete Applications Page

### Sidebar

- New item: **"Incomplete Applications"** between "Pending Actions" and "All Members"
- Icon: Clock or AlertCircle
- **Live badge count** showing `stuck` + `payment_on_hold` count (same pattern as Pending Actions badge)

### Page layout

**Stats bar (top):**
| Total Incomplete | Stuck (no payment) | Payment on Hold | Expired Today |

**Filter tabs:** All | In Progress | Stuck | Payment on Hold | Refund Initiated

**Table columns:**

| Email | Phone | Type | Stuck At | Reason | Since | Payment | Actions |
|-------|-------|------|----------|--------|-------|---------|---------|

- **Stuck At** — human-readable step name: "Document Upload (Step 3)"
- **Reason** — inferred or explicit: "Inactive for 4 hours", "Network error during upload", "Payment verification failed"
- **Since** — relative time: "3 hours ago", "1 day ago"
- **Payment** — badge: "None", "Paid (on hold)", "Refund initiated"

### Admin actions by status

| Status | Actions |
|--------|---------|
| `in_progress` | View details (read-only) |
| `stuck` (no payment) | View details, Send Reminder, Delete |
| `stuck` (with payment) / `payment_on_hold` | View details, Resume Application, **Initiate Refund** |
| `refund_initiated` | View details (waiting for Razorpay confirmation) |

### View details panel

Slide-out panel showing:
- Applicant info (email, phone, membership type)
- Step-by-step progress with checkmarks/pending icons
- Step data preview (documents uploaded, form fields filled)
- Timeline: created → last activity → stuck since → reminder sent
- Admin notes (free-text, saved to draft record)

---

## 4. Cron Job: Hourly Cleanup

**Endpoint:** `GET /api/cron/cleanup-drafts`
**Schedule:** Every hour
**Auth:** Vercel cron secret header (`CRON_SECRET`)

### Logic (in order)

```
1. MARK STALE
   Find drafts where:
     status = 'in_progress' AND updated_at < (now - 2 hours)
   → Set status = 'stuck', stale_since = now()
   → Set failure_reason = 'Application inactive — user did not proceed past step {current_step}'

2. SEND REMINDERS
   Find drafts where:
     status = 'stuck' AND stale_since < (now - 1 hour from stale) AND reminder_sent_at IS NULL
   → Send reminder email to applicant
   → Set reminder_sent_at = now()

3. EXPIRE UNPAID DRAFTS
   Find drafts where:
     status = 'stuck' AND stale_since < (now - 24 hours) AND has_verified_payment = false AND payment_order_id IS NULL
   → Send "application expired" email
   → Delete document files from Supabase Storage
   → Delete draft record
   → Log to membership_audit_log

4. CHECK PAID-BUT-STUCK DRAFTS
   Find drafts where:
     status = 'stuck' AND stale_since < (now - 24 hours) AND (payment_order_id IS NOT NULL OR has_verified_payment = true)
   → Call Razorpay API to check payment status
   → If payment confirmed:
       Set status = 'payment_on_hold', has_verified_payment = true
       Send email to all admin users: "Paid application on hold — action required"
   → If payment not found/failed:
       Treat as unpaid — expire and delete (step 3 logic)

5. CHECK REFUND STATUS
   Find drafts where:
     status = 'refund_initiated'
   → Call Razorpay API to check refund status
   → If refund completed:
       Set status = 'refunded'
       Send "refund completed" email to applicant
       Delete document files from Supabase Storage
       Delete draft record
       Log to membership_audit_log
```

---

## 5. Refund Flow

### Admin initiates refund

1. Admin clicks "Initiate Refund" on a `payment_on_hold` application
2. Confirmation dialog: "Are you sure? This will refund ₹{amount} to the applicant. Refunds take 5-7 business days."
3. API call: `POST /api/applications/refund`
   - Reads `payment_id` from draft
   - Calls Razorpay Refund API: `POST /v1/payments/{payment_id}/refund`
   - On success:
     - Update draft: `status = 'refund_initiated'`
     - Create/update `membership_payments` record: `status = 'refund_initiated'`
     - Send "refund initiated" email to applicant (includes expected timeline)
     - Log to `membership_audit_log`
   - On failure:
     - Show error to admin
     - Log failure to audit log

### Razorpay refund status tracking

- Cron job (step 5) polls Razorpay for refund completion
- When confirmed: status → `refunded`, cleanup draft, send confirmation email
- `membership_payments` record preserved with `status = 'refunded'` for audit trail (never deleted)

### New API endpoint

**`POST /api/applications/refund`**
- Auth: Admin JWT required
- Body: `{ draftId: string }`
- Validates draft exists and has `payment_on_hold` status
- Calls Razorpay refund API
- Returns refund ID and status

---

## 6. Email Templates (3 new)

### 6a. Reminder Email (stuck application)

**Subject:** "Complete your AMASI membership application"
**Sent:** 1 hour after draft becomes stuck
**Content:**
- Greeting with applicant name (if available) or email
- "Your membership application is incomplete. You were on: {step name}."
- "Click below to resume your application where you left off."
- CTA button: "Resume Application" → links to /apply (they'll enter email + OTP to resume)
- "If you no longer wish to apply, no action is needed — your application will be automatically removed after 24 hours."

### 6b. Application Expired Email

**Subject:** "Your AMASI membership application has expired"
**Sent:** When cron deletes a 24-hour-old unpaid draft
**Content:**
- "Your membership application started on {date} has expired due to inactivity."
- "You are welcome to apply again at any time."
- CTA button: "Apply Again" → links to /apply
- "If you believe this is an error, please contact support."

### 6c. Refund Initiated Email

**Subject:** "Refund initiated for your AMASI membership application"
**Sent:** When admin initiates refund
**Content:**
- "A refund of ₹{amount} has been initiated for your membership application."
- "Refunds typically take 5-7 business days to reflect in your account."
- "Razorpay Refund ID: {refund_id}"
- "You are welcome to apply again at any time."
- CTA button: "Apply Again" → links to /apply

### 6d. Refund Completed Email

**Subject:** "Refund completed for your AMASI membership application"
**Sent:** When cron confirms Razorpay refund is complete
**Content:**
- "Your refund of ₹{amount} has been processed successfully."
- "If you don't see it in your account within 2 business days, contact your bank."
- CTA button: "Apply Again" → links to /apply

### 6e. Admin Alert — Paid Application on Hold

**Subject:** "[Action Required] Paid application stuck — {email}"
**Sent to:** All active admin users
**Content:**
- "A paid membership application requires your attention."
- Applicant email, membership type, amount paid, stuck step
- CTA button: "Review Application" → links to /incomplete-applications
- "Please resume the application or initiate a refund within 24 hours."

---

## 7. Security Considerations

- **Draft check only after OTP** — no public endpoint to probe email existence
- **Optimistic locking** — `updated_at` comparison prevents concurrent device conflicts
- **Rate limiting** — save-draft endpoint: 30 requests/15min per IP
- **Admin auth required** — all admin actions (refund, delete, send reminder) require valid admin JWT
- **Cron auth** — cleanup endpoint protected by `CRON_SECRET` header
- **Storage cleanup** — all document files deleted when draft is removed
- **Payment records preserved** — `membership_payments` with `refunded` status kept for audit (never deleted)
- **Audit logging** — all cron actions and admin actions logged to `membership_audit_log`

---

## 8. Files to Create/Modify

### New files
- `sql/0XX_draft_applications.sql` — create table migration
- `src/app/api/applications/save-draft/route.ts` — save draft endpoint
- `src/app/api/applications/refund/route.ts` — initiate refund endpoint
- `src/app/api/cron/cleanup-drafts/route.ts` — hourly cron job
- `src/app/incomplete/page.tsx` — admin incomplete applications page
- `src/lib/draft-utils.ts` — draft CRUD helpers
- Email templates (inline in API routes, matching existing pattern)

### Modified files
- `src/app/api/verify-otp/route.ts` — add draft check after OTP verification
- `src/app/api/applications/submit/route.ts` — delete draft on successful submission
- `src/app/apply/page.tsx` — add resume detection, draft saving after each step, resume modal
- `src/components/layout/sidebar.tsx` — add Incomplete Applications nav item with badge
- `vercel.json` or `vercel.ts` — add cron schedule for cleanup-drafts
