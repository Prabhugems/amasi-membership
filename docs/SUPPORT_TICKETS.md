# Support Tickets

Manage and respond to member support requests.

## Overview

The support tickets module provides a two-sided communication system between AMASI members and admin staff. Members submit tickets via the public support portal; admins triage, reply, and resolve them from a split-panel inbox on the admin dashboard.

---

## Pages

| Route | Audience | Purpose |
|-------|----------|---------|
| `/support` | Members (public) | Create tickets, browse FAQ, track existing tickets by email/phone |
| `/tickets` | Admin (authenticated) | Split-panel inbox — ticket list on left, conversation view on right |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/tickets` | Public | Create a new support ticket |
| `GET` | `/api/tickets` | Public/Admin | List tickets — by email/phone (member) or all (admin with `?all=1`) |
| `GET` | `/api/tickets/[id]` | Admin | Fetch single ticket with all replies |
| `PATCH` | `/api/tickets/[id]` | Admin | Update status, priority, or assignment |
| `POST` | `/api/tickets/[id]/reply` | Admin/Member | Add a reply (supports file attachments up to 10 MB) |

---

## Data Model

### `support_tickets` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `ticket_number` | text | Human-readable ID (format: `TKT-YYYYMMDD-XXXX`) |
| `name` | text | Member's full name |
| `email` | text | Member's email |
| `phone` | text | Member's phone number |
| `amasi_number` | text | AMASI membership number (optional) |
| `category` | text | One of: Application Issue, Profile Update, Payment Issue, Certificate/Card, Technical Issue, Other |
| `subject` | text | Brief summary |
| `description` | text | Full details of the issue |
| `status` | text | `open` · `in_progress` · `resolved` · `closed` |
| `priority` | text | `low` · `normal` · `high` · `urgent` |
| `assigned_to` | text | Team assignment (see below) |
| `created_at` | timestamptz | When the ticket was submitted |
| `updated_at` | timestamptz | Last modification |
| `closed_at` | timestamptz | When the ticket was closed/resolved |

### `ticket_replies` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `ticket_id` | UUID | FK → `support_tickets.id` |
| `message` | text | Reply body |
| `is_admin` | boolean | `true` for staff replies, `false` for member replies |
| `author_name` | text | Display name of the author |
| `created_at` | timestamptz | When the reply was posted |

---

## Status Flow

```
open ──→ in_progress ──→ resolved ──→ closed
  ↑                                      │
  └──────────── reopen ←─────────────────┘
```

- **open** — newly submitted, awaiting staff response
- **in_progress** — admin has acknowledged; auto-set when an admin reply is sent to an `open` ticket
- **resolved** — issue addressed, awaiting member confirmation
- **closed** — ticket is complete; can be reopened if the issue recurs

---

## Assignment Teams

Tickets can be assigned to one of the following teams via the admin panel:

- Unassigned (default)
- AMASI Admin
- Technical Team
- Payment Team
- Membership Team

---

## Member Features

- **Submit a ticket** — select category, set priority, provide subject + description
- **Track tickets** — look up by email or phone number; view all associated tickets
- **View conversation** — chat-style timeline showing member and admin messages
- **Reply** — respond to open/in-progress tickets (replies are blocked once closed)
- **Status timeline** — visual progression indicator (Created → In Progress → Resolved → Closed)
- **FAQ** — 10-item accordion covering common questions (shown on the support portal)

---

## Admin Features

- **Inbox** — paginated ticket list with counts per status (open / in-progress / resolved)
- **Filters** — by status, category, or free-text search (name / email / ticket number)
- **Status management** — update status via dropdown; reopen closed tickets
- **Priority management** — escalate or de-escalate (low / normal / high / urgent)
- **Team assignment** — route tickets to the appropriate team
- **Reply** — send responses with optional file attachments (images, PDFs; max 10 MB)
- **Quick replies** — 6 pre-built templates for common responses
- **Auto-transition** — replying to an `open` ticket automatically sets it to `in_progress`
- **Wait-time badges** — show how long a ticket has been waiting (e.g., "Waiting 2h 15m")
- **Unread indicators** — highlight tickets with new member replies
- **Keyboard shortcut** — `Cmd+Enter` / `Ctrl+Enter` to send a reply
- **Audit logging** — all admin actions (replies, status changes) are recorded in the audit log

---

## Email Notifications

When an admin replies to a ticket, an email is sent to the member via the Resend API containing:

- The ticket number (`TKT-YYYYMMDD-XXXX`)
- The admin's reply text
- A link back to the member support portal to view the full conversation

---

## Files

```
src/app/support/page.tsx              # Member support portal
src/app/tickets/page.tsx              # Admin ticket inbox
src/app/api/tickets/route.ts          # POST (create) + GET (list)
src/app/api/tickets/[id]/route.ts     # GET (detail) + PATCH (update)
src/app/api/tickets/[id]/reply/route.ts   # POST (reply with attachments)
```
