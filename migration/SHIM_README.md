# Legacy Mobile Shim — 2026-05-27 cutover

## Why this exists

`application.amasi.org` (the legacy Laravel-style backend that ran behind
`/api/check_common_login`, `/api/member_two`, `/api/final_step`, etc.) has no
DNS record — confirmed by `dig +short application.amasi.org` returning empty.
The published Flutter binary (`com.amasi.amasi` v1.0.4+2, versionCode 30) on
the Play Store / TestFlight is hardcoded against that contract:

- `lib/main.dart:27` sets `baseUrl = "https://membership.amasi.org/api/"` (the
  amasi-membership Vercel deployment), so every request lands on our infra.
- The 33 endpoint paths the binary calls (`/check_common_login`, `/send_otp`,
  `/member_two`, `/final_step`, …) do not exist as Next.js routes in
  amasi-membership. Every call 401s at our middleware allowlist.

Result: the in-stores app is fully non-functional — login, apply, payment, and
the 4 PDF downloads all fail. This shim restores the apply + payment path
end-to-end *without* a Flutter release. PDF downloads remain broken until DNS
is restored (separately) and/or a Flutter release replaces the hardcoded
`certificateBaseUrl` at `main.dart:31`.

## Scope

**P0 (15 routes — all live):**

| Path | File | Notes |
|---|---|---|
| `GET /api/settings` | `src/app/api/settings/route.ts` | Returns only `data[0].razor_key_id` (no secrets) |
| `GET /api/get_country` | `src/app/api/get_country/route.ts` | Static list (`src/lib/mobile-geo-data.ts`) — 10 countries |
| `POST /api/get_state` | `src/app/api/get_state/route.ts` | India full (36 rows), other countries empty until expanded |
| `GET /api/get_application` | `src/app/api/get_application/route.ts` | Mirrors `MEMBERSHIP_FEES` in `payments/create-order/route.ts` |
| `POST /api/common_member_send_otp` | `src/app/api/common_member_send_otp/route.ts` | Login OTP send — looks up `members` table, emits 6-digit OTP via Resend |
| `POST /api/common_member_otp_verify` | `src/app/api/common_member_otp_verify/route.ts` | Login OTP verify — issues 90d JWT, returns `member: 1` (number, NOT boolean) |
| `POST /api/send_otp` | `src/app/api/send_otp/route.ts` | Apply-flow OTP send — creates/updates draft, returns `userid` + `message1: "insert"` on first call |
| `POST /api/otp_verify` | `src/app/api/otp_verify/route.ts` | Apply-flow OTP verify — preserves the HTTP 201 quirk on invalid OTP per legacy spec §22 |
| `POST /api/resend_otp` | `src/app/api/resend_otp/route.ts` | Re-mint OTP for an existing draft |
| `POST /api/check_application_status` | `src/app/api/check_application_status/route.ts` | 5-branch state machine — "YES"/"NO" application_status, `err_type:1` on member-conflict, trailing-space messages preserved |
| `POST /api/member_two` | `src/app/api/member_two/route.ts` | Multipart step 2 — `profile` file, indexed `clinic_*[i]`, country/state id→name translation, files land in Supabase `uploads/mobile-shim/<draftId>/` |
| `POST /api/member_three` | `src/app/api/member_three/route.ts` | Multipart step 3 — 6 doc files, indexed `work_procedure[i]`, uploads marked `bypass: true, bypassReason: "user_bypass"` so the submit/approve gate routes to manual review |
| `POST /api/create_order` | `src/app/api/create_order/route.ts` | Razorpay order from server-side `APPLICATION_TYPES` fee table (client amount ignored) |
| `POST /api/final_step` | `src/app/api/final_step/route.ts` | **Razorpay Orders/Payments API server-side verify** — client `payment_status` is IGNORED. See "Razorpay signature limitation" |
| `POST /api/application_data` | `src/app/api/application_data/route.ts` | Receipt-screen render with hardcoded `webaddress`/`webphone`/`webemail`/`webgst` per legacy spec §32 |
| `POST /api/check_user_data` | `src/app/api/check_user_data/route.ts` | Member-status flag check by email — used by Flutter events webview WillPop. Returns `member: 1` for active members, else 0; `event: 0` always (events not wired). |
| `POST /api/member_info` | `src/app/api/member_info/route.ts` | Full member profile by id (member UUID). Returns legacy MemberInfo shape with `data[0]` (60+ fields mapped from new schema), `clinic[]` (from `member_clinics`); `work_exp` / `payment_status` / `fmas_data` return `[]` (no equivalent new-schema data yet). |

**Stubs (16 — return `{status: false, message: "feature updating"}`):**

| Path | File |
|---|---|
| `/api/device_token_update` | `src/app/api/device_token_update/route.ts` |
| `/api/check_common_login` | `src/app/api/check_common_login/route.ts` |
| `/api/common_member_resend_otp` | `src/app/api/common_member_resend_otp/route.ts` |
| `/api/memberforgotpassword` | `src/app/api/memberforgotpassword/route.ts` |
| `/api/mobile_notification_list` | `src/app/api/mobile_notification_list/route.ts` |
| `/api/mobile_notification_all_read` | `src/app/api/mobile_notification_all_read/route.ts` |
| `/api/mobile_notification_status_update` | `src/app/api/mobile_notification_status_update/route.ts` |
| `/api/enquiry_form` | `src/app/api/enquiry_form/route.ts` |
| `/api/know_membership` | `src/app/api/know_membership/route.ts` |
| `/api/send_details_toMail` | `src/app/api/send_details_toMail/route.ts` |
| `/api/track_application` | `src/app/api/track_application/route.ts` |
| `/api/get_member_activity` | `src/app/api/get_member_activity/route.ts` |
| `/api/delete_clinic` | `src/app/api/delete_clinic/route.ts` |
| `/api/delete_work_exp` | `src/app/api/delete_work_exp/route.ts` |
| `/api/delete_old_member_application` | `src/app/api/delete_old_member_application/route.ts` |
| `/api/member_conversion` | `src/app/api/member_conversion/route.ts` |

## Architecture

The shim is **thin**: each route translates the legacy Dio
multipart envelope to amasi-membership's native models (or delegates to an
existing internal lib/route) and emits the legacy `{status, message, data}`
envelope back. Source-of-truth lives in the existing codebase
(`payments/create-order`, `otp/{send,verify}`, `applications/submit`, etc.) —
the shim does NOT duplicate business logic.

Shared helpers in `src/lib/mobile-shim.ts`:

- `legacyOk(message, extra)` / `legacyErr(message, extra)` — build response envelopes
- `stubFeatureUpdating(name)` — uniform stub response
- `parseLegacyForm(request)` — accepts both multipart/form-data (Dio default)
  and application/json (callers that wrap a flat body in JSON)
- `field(form, name)` / `fieldOrNull` / `arrayField` / `fileField` — typed
  extractors over `FormData`

Static lookup in `src/lib/mobile-geo-data.ts`:

- `COUNTRIES` (10 rows — expand as needed)
- `STATES` (India only, 36 rows)
- `findCountry(id)`, `findState(id)`, `statesForCountry(countryId)`

ID-to-typeKey mapping in `src/app/api/get_application/route.ts`:

- `APPLICATION_TYPES` (6 rows) + `findApplicationType(id)` — used by shim
  member_two / create_order to translate Flutter's numeric `application_id`
  back to amasi-membership's typeKey strings.

## Known limitations (close in follow-up work)

### Razorpay signature verification

Per `migration/MIGRATION_FINDINGS.md` §3, the Flutter v1.0.4+2 binary's
`_handlePaymentSuccess` callback does NOT forward `razorpay_signature` or
`razorpay_order_id` as named form fields. The signature is technically inside
`payment_json` (the raw Razorpay event map), but `FormData.fromMap()` does not
JSON-encode nested maps — Dio calls `.toString()` on them, producing a
non-parseable Dart-Map-literal string. Server-side HMAC verification is
therefore not possible with this binary.

**Substitute (per migration directive):** the shim's `/final_step` will verify
the Razorpay order + amount server-side via the Razorpay Orders API
(`razorpay.orders.fetch(order_id)` + `razorpay.payments.fetch(payment_id)`)
using our server key. This catches forged `payment_status: "Success"` claims
against an order that wasn't actually paid (the legacy backend trusted the
client unconditionally — replicating that would re-introduce a known fraud
surface). It does NOT catch the subtler attack where an attacker pays a
different order and replays a different payment_id, because we cannot
cryptographically bind the payment to the user's session.

**Follow-up:** a Flutter release that extracts `response.signature` and
`response.orderId` into top-level form fields will let us add HMAC
verification. Open TODO on this codebase + the Flutter repo. Documented in
`MIGRATION_FINDINGS.md` BLOCKER #1.

### Geo data is hardcoded

`src/lib/mobile-geo-data.ts` lists 10 countries and 36 Indian states. ILM
applicants from other countries see an empty state dropdown. Expand the list
or back it with a database table before international member onboarding
resumes at scale.

### `member_info` covers approved-member profile, NOT mid-flow draft resume

`member_info` is now LIVE for the approved-member case — Setting.dart:41
passes `hiveMethod.userid` (member UUID set after OTP login) and gets the
full profile back, including clinics. This unblocks the in-app profile
screen.

The other 6 Flutter call sites are inside the apply wizard (resume after
quit, edit, view details, ACM→LM conversion, Know flow). Those expect a
**draft application id** in `id`, not a member UUID, and they expect the
returned record to include in-flight draft fields the legacy `tbl_member`
held. The current implementation looks up only the `members` table, so the
wizard-resume case will return "Member not found" for any user who didn't
complete their application before the cutover. That's an acceptable gap
because (a) draft applications now live in `membership_applications` /
`drafts` not in `members`, and (b) the new apply flow handles its own
draft resume independently of this shim. Implement a draft fallback only
if the in-stores binary's wizard-resume path proves to be load-bearing.

### PDF downloads remain broken

`lib/main.dart:31` hardcodes `certificateBaseUrl = "https://application.amasi.org/application/"`.
The 4 cert / receipt / invoice / FMAS-cert URLs concatenate against it. No
backend shim can rescue these — they need either a DNS record restoring
`application.amasi.org` to a host we control (with corresponding receipt/cert
endpoints there) OR a Flutter release that replaces the base URL.

### Destructive endpoints stubbed

`delete_clinic`, `delete_work_exp`, `delete_old_member_application` are
stubbed to return `{status: false}`. The Flutter "CREATE FRESH" button
ignores the response and proceeds with `/send_otp` regardless, which may
re-encounter the existing draft and re-trigger the incomplete-application
dialog. Acceptable for emergency cutover; a real implementation needs
ownership checks (the legacy versions had none — pure CSRF data-loss
vectors).

## Required follow-up before this shim handles real members

1. **Rotate all leaked credentials.** Per `memory/legacy_amasi_credential_leak_2026_05_27.md`:
   Firebase Admin key for project `amasi-8a5cc`, `.env` (JWT/AWS/DB/Zepto/TextLocal),
   Android upload-keystore. The new shim sends FCM via Firebase — the leaked
   admin key must be revoked before that traffic begins.
2. **DNS for `application.amasi.org`.** Either resurrect it (so the
   in-stores binary's PDF downloads work) or accept the 4-feature gap until a
   Flutter release replaces `certificateBaseUrl`.
3. **Vercel logs sanity check.** Once the shim is live, watch
   `/api/send_otp` + `/api/check_application_status` + `/api/final_step`
   request volume in Vercel Logs filtered by `X-Source: mobile-app` to confirm
   real traffic is flowing.
4. **Sentry alert.** Add an alert on the new `mobile_app_not_allowlisted`
   tag fingerprint (`middleware.ts:265-300`) — this fires when Flutter calls
   a path we forgot to allowlist or stub.
5. **Flutter release tracking.** Once a coordinated Flutter release is
   planned, the work to close the Razorpay-signature gap + replace
   `certificateBaseUrl` + remove the password login default tab should ship
   together. Open BLOCKER #3 in `MIGRATION_FINDINGS.md`.

### Submission gap (P1 follow-up)

`/final_step` records the verified Razorpay payment and marks the draft as
paid, but it does NOT auto-create the `membership_applications` row. The full
submit flow (`/api/applications/submit/route.ts`) is 60s+ of work — AI scoring,
auto-approval, admin email, WhatsApp, Zoho — and inlining it doubles the
shim's complexity and request time. The shim leaves paid mobile drafts
visible in the admin UI (filter `draft_applications.has_verified_payment=true
AND status='in_progress'`) for manual triage. Add a follow-up cron or admin
batch-submit action to clear them.

## Custom domain (application.amasi.org)

Added 2026-05-27 as a second domain on the `amasi-membership` Vercel
project, so the in-stores binary's calls to the old hostname land on this
shim. DNS configuration (give to whoever manages amasi.org DNS):

| Type | Name | Value | TTL |
|---|---|---|---|
| A | application | `76.76.21.21` | Auto / 300 |

Or equivalently:

| Type | Name | Value | TTL |
|---|---|---|---|
| CNAME | application | `cname.vercel-dns.com` | Auto / 300 |

Vercel auto-issues the Let's Encrypt cert once the record propagates. The
current `amasi.org` zone is on Cloudflare nameservers — keep it there;
just add the single record above. Do NOT delegate the entire zone to
Vercel nameservers (would break every other amasi.org subdomain).

The 4 PDF download paths the Flutter binary hardcodes against
`application.amasi.org/application/user-member-application-{certificate-mobile,fmas-certificate-mobile,receipt,invoice}/{id}`
are now covered by lightweight 307 redirect routes at
`src/app/application/user-member-application-*/[id]/route.ts`. Each delegates
to the native equivalent:

| Legacy path | Redirects to |
|---|---|
| `/application/user-member-application-certificate-mobile/{id}` | `/member/certificate?id={id}` |
| `/application/user-member-application-fmas-certificate-mobile/{id}` | `/member/fmas-certificate?id={id}` |
| `/application/user-member-application-receipt/{id}` | `/api/payments/receipt?id={id}` |
| `/application/user-member-application-invoice/{id}` | `/api/payments/receipt?id={id}` (same HTML doc as receipt; split out only if a distinct invoice template is needed) |

All four are allowlisted in `PUBLIC_ROUTES` (`src/middleware.ts`) so the
Flutter app's unauthenticated browser launch reaches the redirect.

**ID resolution in the cert + FMAS-cert redirects:** Flutter's
`hiveMethod.userid` actually holds the member's Supabase UUID (set in
`Login_controller.dart:255` from `otpVerifyData["data"][0]["id"]`), NOT the
AMASI number. The two cert routes (`*-certificate-mobile`,
`*-fmas-certificate-mobile`) therefore branch on shape:

- Numeric id → already an AMASI number, pass through to `/member/certificate?id=<n>`.
- UUID → lookup `members.id = <uuid>` to get `amasi_number`, then redirect.
  Returns plain-text 404 if the member doesn't exist or `amasi_number` is null
  (application still pending) — "crash loudly" rather than redirect to a
  broken viewer.

Both shim routes are rate-limited per-IP (30 / 15min) as defense in depth
against UUID enumeration, layered on top of `/api/certificate`'s own
20/15min limit.

**Residual gap:** `view/application/application_track_details.dart:425`
passes `appData["id"]` which is an **application id**, not member UUID or
AMASI number. This call site is not yet resolved by the redirect —
implementing it requires joining `membership_applications` →
`members` to get the AMASI number. Same story for receipt/invoice
redirects which take application id today.

## Testing

Vitest harness at `__tests__/mobile-shim-contracts.test.ts` — 28 tests
covering envelope shapes for the 4 static GET routes, the 18 stubs, and the
helper functions in `mobile-shim.ts`. Run with:

```bash
npx vitest run __tests__/mobile-shim-contracts.test.ts
```

Routes requiring real Resend/Razorpay/Supabase service calls (the OTP
routes, multipart submits, payment finalize) are not in the harness — they
need integration tests with mocked deps as P1 follow-up. Manual smoke path:

```bash
# Settings — should return razor_key_id
curl -sS https://membership.amasi.org/api/settings -H "X-Source: mobile-app"

# Country/state dropdowns
curl -sS https://membership.amasi.org/api/get_country -H "X-Source: mobile-app"
curl -sS -X POST https://membership.amasi.org/api/get_state -H "X-Source: mobile-app" \
  -F "id=101"

# Application list
curl -sS https://membership.amasi.org/api/get_application -H "X-Source: mobile-app"

# Stub response shape
curl -sS -X POST https://membership.amasi.org/api/member_info -H "X-Source: mobile-app" -F "id=123"
```

For end-to-end testing against the published Flutter binary, plug the
production `RAZORPAY_KEY_ID` (test mode would let payments succeed but the
binary's hardcoded merchant settings expect live keys) into Vercel preview
env, install the v1.0.4+2 .apk on a device, and walk through apply →
payment → success screen. Catch failures via Sentry's
`x_source:mobile-app` tag filter (now wired in `src/middleware.ts`).
