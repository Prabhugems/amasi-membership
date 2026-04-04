# AMASI Membership Management System — Complete Module Reference

**Association of Minimal Access Surgeons of India**
**Stack**: Next.js 16 + React 19 + TypeScript + Tailwind CSS + Supabase + Razorpay + Claude AI

---

## Table of Contents

1. [Application Wizard](#1-application-wizard)
2. [AI Approval Engine](#2-ai-approval-engine)
3. [Application Status Tracking](#3-application-status-tracking)
4. [Admin Pending Review](#4-admin-pending-review)
5. [Resubmit Flow](#5-resubmit-flow)
6. [Admin Dashboard](#6-admin-dashboard)
7. [Members Directory](#7-members-directory)
8. [Member Search](#8-member-search)
9. [Analytics & Reports](#9-analytics--reports)
10. [Digital Membership Card](#10-digital-membership-card)
11. [Membership Certificate](#11-membership-certificate)
12. [Member Portal (OTP Login)](#12-member-portal-otp-login)
13. [Self-Service Profile Edit](#13-self-service-profile-edit)
14. [Public Verification](#14-public-verification)
15. [Support Ticketing](#15-support-ticketing)
16. [Floating Help Button](#16-floating-help-button)
17. [Email Notifications](#17-email-notifications)
18. [WhatsApp Notifications](#18-whatsapp-notifications)
19. [Razorpay Payment](#19-razorpay-payment)
20. [Document OCR](#20-document-ocr)
21. [Medical College Autocomplete](#21-medical-college-autocomplete)
22. [PIN Code Auto-fill](#22-pin-code-auto-fill)
23. [Global Design System](#23-global-design-system)

---

## 1. Application Wizard

**Route**: `/apply`
**Files**: `src/app/apply/page.tsx`, `src/components/apply/*.tsx`

Multi-step membership application form for doctors to apply for AMASI membership.

### Membership Types
| Code | Full Name | Fee |
|------|-----------|-----|
| LM | Life Member | Rs. 100 (incl. GST) |
| ALM | Associate Life Member | Rs. 100 (incl. GST) |
| ACM | Associate Candidate Member | Rs. 100 (incl. GST) |
| ILM | International Life Member | Rs. 100 (incl. GST) |

### Application Phases
```
check → existing → landing → verify → upload → review → confirm → success
```

### Features
- Step-by-step progress bar with checkmarks on completed steps
- Auto-save draft every 30 seconds to localStorage with resume dialog
- "Estimated time: ~2 minutes" indicator
- Membership type selection with eligibility info and required documents
- Email OTP verification (6-digit, 10 min expiry)
- Document upload with AI OCR extraction (auto-fills fields from certificates)
- Face detection validation on profile photos
- PG degree pill buttons for quick selection (MS General Surgery, MS OBG, MCh, DNB, FRCS)
- 757 NMC medical college autocomplete with state + university auto-fill
- Year of passing as compact number input (not dropdown)
- PIN code auto-fill (city/state via India Post API)
- Review phase with circular completion percentage
- Razorpay payment integration
- Animated success page with reference number copy button and "What happens next" timeline
- Mobile-optimized with 44px touch targets
- Keyboard shortcut: Ctrl+Enter to proceed

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/applications/submit` | Submit application, run AI scoring |
| GET | `/api/applications/check-duplicate` | Check if email/phone already has pending application |

---

## 2. AI Approval Engine

**File**: `src/lib/ai-approval.ts`

Automated scoring system that evaluates membership applications and auto-approves when confidence is high enough.

### Scoring Checks (Total: 100%)
| Check | Weight | What it verifies |
|-------|--------|-----------------|
| Name Consistency | 25% | Name matches across documents and form |
| Degree Validation | 25% | PG degree is AMASI-eligible (surgical/MAS specialty) |
| College/University Match | 20% | College matches NMC database |
| MCI Registration | 15% | Valid MCI/NMC registration number format |
| Document Verification | 15% | All required documents uploaded and OCR verified |

### Auto-Approval Rules
- Score >= 80% AND payment = "paid" → auto-approved, AMASI number assigned
- Score 50-79% → flagged for manual review
- Score < 50% → flagged with AI concerns

### Confidence Levels
- **High** (80-100%): Green — auto-approved
- **Medium** (50-79%): Amber — needs admin review
- **Low** (0-49%): Red — likely issues found

---

## 3. Application Status Tracking

**Route**: `/apply/status`
**Files**: `src/app/apply/status/page.tsx`, `src/app/api/applications/status/route.ts`

Public page for applicants to track their application status.

### Features
- Search by reference number (AMASI-YYYY-XXXXX), email, or phone number
- Visual 4-step timeline: Submitted → Payment → Under Review → Decision
- Each step shows status (completed/current/upcoming/error) with date
- Multiple applications support (all apps shown when searching by email/phone)
- Pulsing current step indicator
- AMASI number prominently displayed for approved applications
- Clarification/resubmit banner with "Edit & Resubmit" button
- Estimated review time: "Usually reviewed within 1-2 business days"
- Notification signup: "Get Status Updates" via email
- Link to verification page for approved members

### Status Values
| Status | Display Label | Badge Color |
|--------|--------------|-------------|
| submitted | Submitted | Amber |
| pending_review | Under Review | Amber |
| ai_approved | AI Approved | Green |
| approved | Approved | Green |
| rejected | Rejected | Red |
| need_clarification | Clarification Needed | Amber |
| resubmit_requested | Resubmit Requested | Amber |

---

## 4. Admin Pending Review

**Route**: `/pending`
**File**: `src/app/pending/page.tsx`

Admin interface for reviewing and acting on membership applications.

### Tab Filters
- Pending Review (submitted + pending_review)
- AI Approved
- Clarification (need_clarification + resubmit_requested)
- Approved
- Rejected
- All

### "My Action" Dropdown (per application)
| Action | Effect | Email Sent |
|--------|--------|-----------|
| Approve | Assigns AMASI number, updates status | Approval email with membership number |
| Need Clarification | Sets status to `need_clarification` | Email with admin message + resubmit link |
| Ask to Resubmit | Sets status to `resubmit_requested` | Email with instructions + resubmit link |
| Reject | Sets status to `rejected` | Rejection email with reason |

### Features
- Comprehensive member detail panel: photo, personal info (2-column grid), education table, medical registration, document thumbnails
- Document thumbnails with click-to-view-full-size lightbox
- AI confidence visual meters (green/amber/red progress bars)
- Document comparison view: form data vs OCR extracted data with mismatch highlighting
- Application timeline: Submitted → AI Reviewed → Admin Action → Outcome
- Internal notes system (private, not sent to applicant)
- Bulk actions: checkboxes to select multiple, bulk approve/reject
- Keyboard navigation: Up/Down arrows, Enter to expand, A to approve, R to reject, Escape to close
- Advanced filters: date range, membership type, AI confidence level
- Search by name, email, phone, reference number

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/applications/list` | List applications with status filter |
| POST | `/api/applications/approve` | Approve and assign AMASI number |
| POST | `/api/applications/reject` | Reject with reason |
| POST | `/api/applications/clarification` | Need Clarification / Ask to Resubmit |

---

## 5. Resubmit Flow

**Route**: `/apply/resubmit?ref=AMASI-XXXXX`
**Files**: `src/app/apply/resubmit/page.tsx`, `src/app/api/applications/resubmit/route.ts`

Allows applicants to edit and resubmit their application after admin requests clarification or corrections.

### Flow
1. Page loads with `?ref=AMASI-XXXXX` query param
2. Fetches application data from status API
3. Validates status is `need_clarification` or `resubmit_requested`
4. Shows admin's message/reason prominently (blue for clarification, amber for resubmit)
5. Pre-fills all form fields from existing application
6. Allows editing: personal info, address, education, medical registration, documents
7. Email and phone are read-only
8. On submit: updates application, resets status to `submitted`, sends confirmation email

### Editable Sections
- Personal Info: salutation, name, father's name, DOB, gender
- Address: street, city, state, PIN code, country
- Education: PG degree, college, university, year, UG college
- Medical Registration: MCI number, MCI state, ASI number
- Documents: photo, PG certificate, MCI certificate (re-upload)

---

## 6. Admin Dashboard

**Route**: `/`
**Files**: `src/app/page.tsx`, `src/components/dashboard/stat-card.tsx`, `src/app/api/dashboard/route.ts`

Admin overview with key metrics and recent activity.

### Features
- Time-of-day greeting: "Good morning/afternoon/evening, Admin"
- Current date display
- Call-to-action: "X applications awaiting review" → links to /pending

### Stat Cards (6 cards with gradients + sparklines)
| Card | Data |
|------|------|
| Total Members | Count from members table |
| Pending Applications | Submitted + pending_review count |
| Approved This Month | Approved applications this month |
| Revenue Collected | Total payment amount |
| Incomplete Profiles | Members missing required fields |
| Active Tickets | Open support tickets |

### Dashboard Sections
- Membership type distribution bar (LM/ALM/ACM/ILM with color segments)
- Recent applications table with avatars, type badges, status pills, quick actions
- Activity feed timeline (recent events with relative timestamps)
- Membership breakdown cards (4-column grid with progress bars per type)

---

## 7. Members Directory

**Route**: `/members`
**Files**: `src/app/members/page.tsx`, `src/app/api/members/list/route.ts`

Searchable, filterable, paginated list of all AMASI members.

### Features
- Table view with sortable columns: Photo+Name, AMASI#, Type, State, Zone, Status, PG Degree
- Grid/List toggle view
- Alternating row colors
- Advanced filter pills: Membership Type (LM/ALM/ACM/ILM), State, Zone, Status
- Active filters shown as removable tag pills
- Click column headers to sort (asc/desc)
- Hover preview popup: photo, degree, college, phone
- Export CSV button (downloads filtered list)
- Pagination: "Showing 1-50 of 18,016 members"
- Skeleton loaders during data fetch
- Empty state with "Clear all filters" button

### API Parameters
| Param | Values |
|-------|--------|
| page | Page number |
| limit | Items per page |
| search | Search text |
| type | LM, ALM, ACM, ILM |
| state | Indian state name |
| zone | North/South/East/West/Central |
| status | active, inactive |
| sort | name, membership_no, state, etc. |
| dir | asc, desc |

---

## 8. Member Search

**Route**: `/search`
**Files**: `src/app/search/page.tsx`, `src/app/api/members/search/route.ts`

Find members by any identifier.

### Features
- Instant search with 300ms debounce
- Autocomplete suggestions dropdown as user types
- Search by: email, phone, name, AMASI number
- Rich result cards: photo, name, AMASI#, type badge, state, degree, status
- Quick actions per result: View Profile, Edit Profile, View Card, View Certificate
- Recent searches saved to localStorage with timestamps
- Illustration-style empty state when no results found
- Escape key closes suggestions

---

## 9. Analytics & Reports

**Route**: `/reports`
**Files**: `src/app/reports/page.tsx`, `src/app/api/reports/route.ts`

Charts and analytics for membership data.

### Summary Cards
- Total Members
- New This Period
- Approval Rate (%)
- Avg Processing Time

### Charts (recharts library, interactive with tooltips)
| Chart | Type | Toggle Options |
|-------|------|---------------|
| Members by Zone | Bar/Pie/Donut | Toggle between chart types |
| Members by Membership Type | Bar/Pie/Donut | Toggle between chart types |
| Applications by Month | Area chart | Date range filter |
| Top 10 States | Horizontal bar/Pie/Donut | Toggle between chart types |
| Approval Rate | Donut | Approved/Pending/Rejected |

### Features
- Date range selector: Last 30 days, Last 90 days, This year, All time
- Chart type toggles (bar ↔ pie ↔ donut)
- Teal color palette matching app theme
- Export CSV (all data)
- Export PDF (triggers print)

---

## 10. Digital Membership Card

**Route**: `/card`
**Files**: `src/app/card/page.tsx`, `src/app/api/card/route.ts`

View and download styled digital membership card.

### Card Design
- Premium gradient background (teal to dark teal)
- AMASI logo watermark
- Holographic shimmer CSS animation
- Gold border and shadow for Life Members
- Member photo, name, AMASI number, type, MCI number, state/zone
- QR code for verification

### Front & Back Views
- **Front**: Photo, name, AMASI number, membership type, QR code, voting status
- **Back**: Magnetic strip style, large QR code, verification URL, contact info, AMASI address

### Actions
| Action | Description |
|--------|-------------|
| Download PNG | High-res 3x scale |
| Download PDF | Credit-card sized, front + back pages |
| Share Link | Web Share API with clipboard fallback |
| Share WhatsApp | Pre-filled message with link |
| Print Card | Print-optimized window |
| Apple/Google Wallet | Coming soon |

### Search
- Search by email, phone, or AMASI number
- Auto-suggestions dropdown as user types

---

## 11. Membership Certificate

**Route**: `/member/certificate`
**Files**: `src/app/member/certificate/page.tsx`, `src/app/api/certificate/route.ts`

Generate and download membership certificate with per-term president/secretary signatures.

### Certificate Templates
10 template images covering president terms from 2005-2026 at `/public/certificates/term-*.png`

Signature images at `/public/certificates/signatures/`

### Features
- Certificate rendered on HTML5 canvas with template image overlay
- Premium frame with layered shadows
- "This certificate is verified" badge with green glow
- Verification URL displayed

### Download Options
| Format | Details |
|--------|---------|
| PNG | 3x scale, high-res |
| PDF | A4 portrait, centered with margins (via jspdf) |
| Print | A4-optimized print window |
| Share | Web Share API / clipboard |
| Email | Opens mailto: with pre-filled subject |
| Copy Link | Copy verification URL |

---

## 12. Member Portal (OTP Login)

**Route**: `/member`
**File**: `src/app/member/page.tsx`

Member-facing portal with OTP authentication.

### Login Flow
```
Enter Email → Send OTP → Enter 6-digit OTP → Dashboard
```

### Login Page Features
- Centered form with subtle background pattern
- AMASI branding with full association name
- Member benefits sidebar (desktop): Digital Card, Certificates, Profile, Verification
- "Not a member yet?" link to apply

### Dashboard Features
- Gradient welcome banner: "Welcome back, Dr. [Name]" with photo and AMASI number
- Membership status card: Type, Member Since, AMASI Number, Active status
- Quick action cards grid: Card, Certificate, Edit Profile, Upload Documents, Support
- Profile completeness ring (weighted field scoring)
- Notification center with contextual updates
- Enhanced sidebar: 6 tabs (Overview, Card, Certificate, Profile, Documents, Support)
- Session management: 15-min inactivity timeout with warning at 13 min
- "Stay Signed In" button to reset timer

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/otp/send` | Send 6-digit OTP to email (rate-limited: 3/10min) |
| POST | `/api/otp/verify` | Verify OTP |

---

## 13. Self-Service Profile Edit

**Route**: `/profile`
**Files**: `src/app/profile/page.tsx`, `src/components/profile/*.tsx`, `src/lib/profile-mapper.ts`

OTP-gated profile editor for members.

### Phase Flow
```
identify → otp → view → edit → review → success
```

### Profile View Features
- Gradient banner header with large avatar, name, AMASI number, type badge
- Photo hover overlay with "Change" button
- Profile completeness progress bar with missing fields listed
- Sticky section navigation sidebar (scrollspy with IntersectionObserver)
- 5 detail sections: Personal Info, Address, Education, Medical Registration, Documents
- Each section in a card with colored icon header
- "Last updated" timestamp

### Profile Edit Features
- 5 collapsible sections: Personal, Address, Education, Registration, Documents
- Inline validation (green checkmarks / red errors)
- Email and phone are read-only (identity fields)
- Document upload to Supabase Storage
- PG degree pill buttons + 757 medical college autocomplete
- PIN code auto-fill for address

### Review & Diff
- Clean table: Field | Old Value (red) | → | New Value (green)
- Photo changes: circular before/after previews
- "X fields will be updated" summary badge
- Partial updates only (API accepts only changed fields)
- Audit log: every change logged to `membership_audit_log`

### Components
| Component | Purpose |
|-----------|---------|
| `profile-identify.tsx` | Email/phone/AMASI number lookup |
| `profile-otp.tsx` | OTP verification step |
| `profile-view.tsx` | Read-only profile display |
| `profile-edit-form.tsx` | Sectioned edit form |
| `profile-review.tsx` | Diff view before save |
| `education-section.tsx` | Education fields with college autocomplete |

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/members/[id]/update` | Update member profile |
| POST | `/api/members/upload` | Upload documents to Supabase Storage |

---

## 14. Public Verification

**Route**: `/verify`
**File**: `src/app/verify/page.tsx`

Public page for patients/hospitals to verify a doctor's AMASI membership.

### Features
- "Official Membership Verification" header with ShieldCheck icon
- Trust indicators: "Verified by AMASI", "3,500+ Active Members"
- Search by AMASI number or QR code scan
- QR scan helper button

### Verification Result (Member Found)
- Animated green "Verified" badge with pulsing ring
- Member photo, name, AMASI number, membership type
- Active/Inactive status with valid-until date
- Medical credentials: PG Degree, College, MCI Number
- QR code linking back to verification page
- Share Verification button (Web Share API)
- Print verification button

### Not Found State
- "This number does not match any active AMASI member"
- Contact support link

### Empty State
- Three-column info grid: Enter number → Instant verification → View credentials

---

## 15. Support Ticketing

**Routes**: `/support` (member), `/tickets` (admin)
**Files**: `src/app/support/page.tsx`, `src/app/tickets/page.tsx`

Full ticketing system for member support with admin management.

### Ticket Structure
```
Ticket Number: TKT-YYYYMMDD-XXXX (e.g., TKT-20260404-B3K9)
```

### Database Tables
| Table | Columns |
|-------|---------|
| `support_tickets` | id, ticket_number, name, email, phone, amasi_number, category, subject, description, status, priority, created_at, updated_at, closed_at |
| `ticket_replies` | id, ticket_id, message, is_admin, author_name, created_at |

### Categories
- Application Issue
- Profile Update
- Payment Issue
- Certificate/Card
- Technical Issue
- Other

### Status Flow
```
open → in_progress → resolved → closed
                  ↗ (can reopen)
```

### Member Support Page (`/support`)
- 10-item collapsible FAQ accordion
- Ticket submission form: name, email, phone, AMASI number, category, priority, subject, description
- File attachment support (screenshots, up to 5MB)
- Character counter on description (0/2000)
- Track tickets by email/phone
- WhatsApp-style chat bubbles (member right, admin left)
- Status timeline: Created → In Progress → Resolved → Closed
- Typing indicator animation after sending reply

### Admin Tickets Page (`/tickets`)
- Split inbox layout: ticket list (1/3) + conversation (2/3)
- Stats bar: total, open, in-progress, resolved counts
- Filter by status, category, search
- Priority color coding: urgent=red, high=amber, normal=blue, low=gray
- Time-to-response badges ("Waiting 2h 15m")
- Unread indicators (blue dot + bold for new member replies)
- 6 quick reply templates (Acknowledging, Need reference, Resolved, Escalated, Need screenshot, Payment follow-up)
- Assignee field: Unassigned, AMASI Admin, Technical Team, Payment Team, Membership Team
- Compact action bar: status, priority, assignee dropdowns inline
- Close/Reopen ticket button
- Cmd+Enter keyboard shortcut to send

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/tickets` | Create new ticket |
| GET | `/api/tickets` | List tickets (by email/phone or all) |
| GET | `/api/tickets/[id]` | Get ticket + replies |
| POST | `/api/tickets/[id]/reply` | Add reply |
| PATCH | `/api/tickets/[id]` | Update status/priority |

---

## 16. Floating Help Button

**File**: `src/components/ui/help-button.tsx`
**Appears on**: `/apply`, `/apply/status`, `/profile`, `/member`

Fixed-position floating button (bottom-right) with support options.

### Options
| Option | Action |
|--------|--------|
| Submit a Ticket | Links to `/support` |
| WhatsApp | Opens chat with +91 7358105244 |
| Email | Opens mailto: membership@amasi.org |
| Call | Direct phone call |

---

## 17. Email Notifications

**Provider**: Resend (API key configured)
**File**: `src/lib/` (used in various API routes)

### Email Templates
| Trigger | Subject | Content |
|---------|---------|---------|
| OTP Sent | AMASI — Your Verification Code | 6-digit OTP with 10 min expiry |
| Application Submitted | AMASI Application Received | Confirmation with reference number |
| Application Approved | AMASI — Membership Approved | AMASI number, card/certificate links |
| Application Rejected | AMASI — Application Update | Reason, reapply instructions |
| Need Clarification | AMASI — Action Required | Admin message + resubmit link |
| Ask to Resubmit | AMASI — Action Required | Instructions + resubmit link |
| Application Resubmitted | AMASI — Application Resubmitted | Confirmation, status: Under Review |

---

## 18. WhatsApp Notifications

**Provider**: Gallabox API
**File**: `src/lib/whatsapp.ts`

### Templates (4 pre-approved)
| Template | Parameters |
|----------|-----------|
| Application Submitted | Name |
| Membership Approved | Name, AMASI Number, Link |
| Payment Pending | Name, Amount, Link |
| Certificate Ready | Name, Link, Phone |

---

## 19. Razorpay Payment

**Files**: `src/app/api/payments/create-order/route.ts`, `src/app/api/payments/verify/route.ts`

### Flow
```
Create Order → Razorpay Checkout → Webhook Verify → Update Application
```

### Features
- Order creation with amount, currency (INR), receipt
- Route API split: fee transferred to Events 360 account (acc_SYV3ZpQvinGqOW)
- Webhook signature verification
- Payment status tracking: pending → paid → failed

---

## 20. Document OCR

**Files**: `src/lib/client-ocr.ts` (browser), `src/lib/ocr.ts` (server), `src/app/api/ocr/route.ts`, `src/lib/ai-extract.ts`

### Processing Pipeline
1. **Browser-side** (Tesseract.js): Quick OCR on uploaded images
2. **Server-side** (OCR.Space API): More accurate extraction for verification
3. **AI Extract**: Pattern-based field extraction from OCR text

### Documents Processed
| Document | Fields Extracted |
|----------|-----------------|
| MCI Certificate | Council number, state, registration date |
| PG Degree | Degree name, college, university, year |
| ASI Certificate | ASI membership number |
| Profile Photo | Face detection validation (canvas pixel analysis) |

### Safety Checks
- Bank statement detection (financial keyword rejection)
- Medical keyword validation (ensures document is medical-related)
- Irrelevance detection for non-medical documents

---

## 21. Medical College Autocomplete

**Files**: `src/data/medical-colleges-india.ts`, `src/components/ui/autocomplete.tsx`

- 757 NMC-recognized medical colleges across India
- Each college has: name, state, university
- Searchable autocomplete (type 2+ chars)
- Auto-fills university when college is selected
- Used in application wizard and profile edit

---

## 22. PIN Code Auto-fill

**Files**: `src/app/api/pincode/route.ts`

- Enter 6-digit PIN code → auto-fills city and state
- Uses India Post API (api.postalpincode.in)
- Used in application wizard and profile edit address sections

---

## 23. Global Design System

### Files
| File | Purpose |
|------|---------|
| `src/app/globals.css` | Theme variables, micro-interactions, scrollbar, skeleton, print styles |
| `src/app/layout.tsx` | Root layout with fonts, metadata, providers |
| `src/components/layout/sidebar.tsx` | Collapsible admin sidebar with badge counts |
| `src/components/layout/main-content.tsx` | Dynamic content padding based on sidebar state |
| `src/components/providers/sidebar-provider.tsx` | Sidebar collapse state context |
| `src/components/providers/query-provider.tsx` | TanStack React Query provider |
| `src/app/icon.svg` | SVG favicon (teal "A") |

### Theme Colors
| Variable | Light | Dark |
|----------|-------|------|
| Primary | #0f766e (teal) | #14b8a6 |
| Background | #ffffff | #0a0a0a |
| Card | #ffffff | #111111 |
| Destructive | #ef4444 | #dc2626 |
| Success | #16a34a | #22c55e |
| Warning | #f59e0b | #f59e0b |

### Sidebar Features
- Collapsible to icon-only mode (64px) — stored in localStorage
- Active indicator bar on current nav item
- Badge counts: Pending Applications, Open Tickets (refreshes every 60s)
- Admin avatar and name at top
- Section separators between Admin and Membership
- Footer: "AMASI v1.0" + www.amasi.org link
- Tooltips on items when collapsed

### Global CSS Features
- Custom scrollbar (thin, rounded, theme-colored)
- Skeleton shimmer animation for loading states
- Focus-visible accessibility styles (keyboard navigation)
- Print styles: hides sidebar/header, shows only content
- Micro-interactions: input focus glow, hover borders, button press scale, checkbox animation
- Smooth scroll behavior
- Selection color (teal tint)

### OpenGraph Meta Tags
```
Title: AMASI — Membership Management System
Description: Association of Minimal Access Surgeons of India
```

---

## UI Component Library

All components at `src/components/ui/`:

| Component | Variants |
|-----------|----------|
| `button.tsx` | default, destructive, outline, secondary, ghost, link, success |
| `card.tsx` | Card, CardContent, CardHeader, CardTitle, CardDescription |
| `input.tsx` | Standard text input |
| `textarea.tsx` | Multi-line text input |
| `label.tsx` | Form label |
| `badge.tsx` | default, secondary, destructive, outline, success, warning |
| `avatar.tsx` | Avatar, AvatarImage, AvatarFallback |
| `dialog.tsx` | Dialog, DialogContent, DialogHeader, DialogTitle |
| `autocomplete.tsx` | Searchable select/autocomplete dropdown |
| `file-upload.tsx` | File picker with preview |
| `field-help.tsx` | Inline help text for form fields |
| `help-button.tsx` | Floating help button with support options |
| `tabs.tsx` | Tab navigation |
| `tooltip.tsx` | Hover tooltip |
| `select.tsx` | Dropdown select |

---

## Library Files

| File | Purpose |
|------|---------|
| `src/lib/supabase.ts` | Supabase admin + browser client initialization |
| `src/lib/ai-approval.ts` | 5-check scoring engine (80% auto-approval threshold) |
| `src/lib/ai-extract.ts` | Pattern-based OCR field extraction from documents |
| `src/lib/application-utils.ts` | Reference number generation (AMASI-YYYY-XXXXX), duplicate check |
| `src/lib/client-ocr.ts` | Browser-side OCR using Tesseract.js |
| `src/lib/face-detect.ts` | Profile photo face detection (canvas pixel analysis) |
| `src/lib/membership-types.ts` | LM/ALM/ACM/ILM rules, fees, required docs, state-to-zone mapping |
| `src/lib/ocr.ts` | Server-side OCR via OCR.Space API |
| `src/lib/profile-mapper.ts` | DB ↔ form field mapping, diff computation, missing field check |
| `src/lib/utils.ts` | cn(), formatDate(), formatPhone(), getInitials(), getStatusColor() |
| `src/lib/validators.ts` | Form validation: personal, education, registration, documents |
| `src/lib/whatsapp.ts` | Gallabox WhatsApp template sender |
| `src/lib/api.ts` | External AMASI API client |

---

## Complete API Reference

### Applications (8 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/applications/submit` | Submit new application + AI scoring |
| GET | `/api/applications/status` | Get status by ref/email/phone |
| GET | `/api/applications/list` | List with status filter |
| POST | `/api/applications/approve` | Admin approve + assign AMASI# |
| POST | `/api/applications/reject` | Admin reject with reason |
| POST | `/api/applications/clarification` | Need Clarification / Ask to Resubmit |
| POST | `/api/applications/resubmit` | Applicant resubmits with updates |
| POST | `/api/applications/confirm` | Confirm payment receipt |
| GET | `/api/applications/check-duplicate` | Duplicate check |

### Members (4 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/members/list` | Paginated list with filters |
| GET | `/api/members/search` | Search by any identifier |
| POST | `/api/members/[id]/update` | Update member profile |
| POST | `/api/members/upload` | Upload documents |

### Tickets (4 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/tickets` | Create ticket |
| GET | `/api/tickets` | List tickets |
| GET | `/api/tickets/[id]` | Get ticket + replies |
| POST | `/api/tickets/[id]/reply` | Add reply |
| PATCH | `/api/tickets/[id]` | Update status/priority |

### Auth (4 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/otp/send` | Send email OTP |
| POST | `/api/otp/verify` | Verify email OTP |
| POST | `/api/otp/send-sms` | Send SMS OTP |
| POST | `/api/otp/verify-sms` | Verify SMS OTP |

### Payments (2 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/payments/create-order` | Create Razorpay order |
| POST | `/api/payments/verify` | Verify payment webhook |

### Utilities (5 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/dashboard` | Admin dashboard stats |
| POST | `/api/ocr` | Document OCR extraction |
| GET | `/api/reports` | Analytics data |
| GET | `/api/pincode` | PIN code → city/state |
| GET | `/api/card` | Membership card data |
| GET | `/api/certificate` | Certificate data with signatures |

---

## Database Tables (Supabase)

| Table | Purpose |
|-------|---------|
| `members` | All AMASI members (18,016 records) |
| `membership_applications` | New membership applications |
| `membership_audit_log` | Profile change audit trail |
| `support_tickets` | Support tickets |
| `ticket_replies` | Ticket conversation replies |
| `otp_codes` | OTP verification codes |
| `presidents` | President/Secretary terms for certificates |

---

## External Services

| Service | Purpose | Config |
|---------|---------|--------|
| Supabase | Database + Storage + Auth | Project: jmdwxymbgxwdsmcwbahp |
| Razorpay | Payment gateway | Route split to acc_SYV3ZpQvinGqOW |
| Resend | Email notifications | API key in env |
| Gallabox | WhatsApp notifications | API key in env |
| OCR.Space | Server-side OCR | API key in env |
| India Post API | PIN code lookup | Public API |
| Anthropic (Claude) | AI document validation | API key in env |

---

## Deployment

- **Platform**: Vercel
- **Domain**: application.amasi.org
- **Website**: www.amasi.org
- **Environment Variables**: Supabase URL/keys, Razorpay keys, Resend API key, Gallabox API key, OCR.Space API key, Anthropic API key

---

*Last updated: April 4, 2026*
*Built for AMASI — Association of Minimal Access Surgeons of India*
