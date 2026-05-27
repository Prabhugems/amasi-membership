# AMASI Legacy Backend — Shim Layer Spec

Source: `/Users/prabhubalasubramaniam/amasi-legacy-backend/`
Stack: Node 18+/Express 4 + mysql2/promise pool + Razorpay SDK + nodemailer (Zepto Mail SMTP) + firebase-admin (FCM) + AWS S3 v3.

All 33 endpoints below are mounted under `/api` (`app.js:51`). Routes live in `routes.js`. Handlers all live in `controller.js` as keys of a single giant `module.exports = { ... }` object (line 2254). **None of the 33 mobile endpoints in this spec require JWT** — the `validate` middleware is only used for `/refresh`. Mobile clients call them with `x-source` header (defaults to `"website"`) and an optional `device_id` body field.

---

## Schema summary

Every MySQL table touched by the 33 handlers, with the columns each handler reads/writes. Extracted from explicit column lists in SQL strings; `SELECT *` rows include all columns, but only the ones the handler clearly touches are noted.

### tbl_member
The central applicant/member table. Used by virtually every handler. Notable columns:

- **identity:** `id` (PK), `salutation`, `first_name`, `middle_name`, `last_name`, `father_name`, `dob`, `age`, `nationality`, `gender`, `email`, `mobile_code`, `mobile`
- **address:** `street_line1`, `street_line2`, `country`, `state`, `city`, `pin`, `zone`, `landline`, `stdcode`, `mailing_address`
- **education:** `edu_undergrad_degree`, `edu_undergrad_college`, `edu_undergrad_university`, `edu_undergrad_year`, `edu_postgrad_*`, `edu_superspecialty_*`
- **regulatory:** `mci_council_number`, `mci_council_state`, `imr_reg_no`, `asi_membership_no`, `asi_state`, `other_inter_organisation`, `other_inter_organisation_value`
- **application:** `application_id` (FK to `tbl_application`), `application_no` (e.g. `LM18302`), `application_no_without_letter` (e.g. `18302`), `application_status` (FK to `tbl_status_master`; 0=draft, 3=approved/member-allocated, 6/7/9 = OTP-pending-ish, 10=payment-pending, 12=approved-final), `member_reg_date`, `membership_no`
- **auth/session:** `password` (md5), `pass` (plaintext!), `otp` (4-digit), `otp_verify` (0/1), `otp_time`, `last_login`, `login_by`, `device_id`, `status` (1=active, 0=soft-deleted)
- **uploaded docs:** `profile`, `mci_certificate`, `pg_degree_certificate`, `asi_member_certificate`, `active_license`, `letter_hod`, `mbbs_degree_certificate` (all hold S3 URLs from `member2025` bucket)
- **razorpay:** `Razorpay_orderID` (note the capital R + camelCase)
- **timestamps:** `created_on`, `updated_on`, `register_by`

Handlers writing to `tbl_member`: `send_otp` (INSERT new draft + OTP), `otp_verify`, `resend_otp`, `member_two` (UPDATE personal/address), `member_three` (UPDATE education/regulatory), `final_step` (UPDATE status to 3 + reg_date), `create_order` (UPDATE status to 10 + Razorpay_orderID), `member_conversion` (UPDATE application_id + ASI fields by `membership_no`), `delete_old_member_application` (hard DELETE), `delete_member` (soft delete via `status=0`), `check_common_login`/`common_member_*` (session updates), `delete_member_account` (status=0).

### tbl_clinic_address
Multi-row per member. Columns: `id`, `member_id` (FK), `clinic_name`, `clinic_address_one`, `clinic_address_two`, `clinic_country`, `clinic_state`, `clinic_city`, `clinic_pin_code`, `clinic_stdcode`, `clinic_landline`, `clinic_mailing_address`, `created_on`, `updated_on`. Written by `member_two` (insert or update per index in arrays). Deleted by `delete_clinic`. Read by `member_info` (joined w/ countries + states).

### tbl_work_exp
Multi-row per member. Columns: `id`, `member_id` (FK), `work_procedure`, `exp_in_year`, `no_of_procedures1`, `no_of_procedures2`, `created_on`, `updated_on`. Written by `member_three` per index. Deleted by `delete_work_exp`. Read by `member_info`.

### tbl_application
The membership-type catalog (LM, ALM, ACM, ILM, etc.). Columns: `id`, `application_name`, `fee`, `gst_type` (FK), `gst` (FK), `currency_type` (FK), `processing_fee` (percentage), `status` (1=active). Read by `get_application`, `create_order`, `final_step`, `application_data`, `track_application`. Never written by mobile handlers (admin-only).

### tbl_status_master
Status code → name map. Columns: `id`, `status_name`. Read in joins by `member_info`, `track_application`, `know_membership`, `application_data`, `get_member_activity`.

### tbl_member_activity
Status-change activity log. Columns: `id`, `member_id`, `application_status`, `message`, `created_by`, `created_on`. Written by `final_step` (status 3) and `member_conversion` (status_master + 3). Read by `get_member_activity` (joined w/ status_master).

### tbl_member_payment
Payment ledger row created on `final_step`. Columns: `id`, `member_id`, `payment_method`, `amount`, `gstamount`, `gst_value`, `application_fee`, `application_process_fee`, `currency`, `customerName`, `customerEmail`, `payed_date` (sic), `payment_status` (1=Success, 2=Failed, 3=Pending), `payment_id` (Razorpay payment id), `payment_json` (JSON of full Razorpay payload), `created_on`. Read by `member_info`, `track_application`, `know_membership`, `application_data` (joined w/ `tbl_payment_status`).

### tbl_payment_status
Lookup. Columns: `id`, `payment_status_name`. Read-only by mobile.

### tbl_member_log
Conversion audit. Columns: `id`, `member_id`, `m_application_id`. Written by `member_conversion` to snapshot the pre-conversion application_id.

### tbl_notification
In-app notifications. Columns: `id`, `member_id`, `title`, `description`, `notify_from`, `notify_to`, `read_status` (1=unread, 2=read). Read by `mobile_notification_list` (joined w/ `tbl_member.first_name`). Updated by `mobile_notification_status_update` (single row), `mobile_notification_all_read` (bulk per member).

### tbl_settings
Single-row config. Columns: `id`, `website_name`, `email`, `phone`, `logo`, `razor_key_id`, `razor_key_secret` (Razorpay live creds stored in DB), `webaddress`, `webgst`, `place_of_supply`, `smtp_email`, `smtp_password`. Read by `settings`, `create_order`, `final_step` (via `runPaymentVerification`).

### tbl_enquiry_form
Public contact form. Columns: `id`, `first_name`, `last_name`, `email_id`, `mobile_number`, `member_no`, `subject`, `message`, `created_on`. Written by `enquiry_form` (INSERT only from mobile).

### tbl_fmas / tbl_fmas_certificate
FMAS (Fellowship MAS) records. Columns on `tbl_fmas`: `id`, `amasi_number` (joins to `tbl_member.membership_no`), `year_of_convocation`. Columns on `tbl_fmas_certificate`: `id`, `year_of_fmas`, `status`. Read by `member_info`.

### countries / states / tbl_currency_list / tbl_gst / tbl_gst_type
Lookup tables. `countries`: `id`, `country_name`, `status`. `states`: `id`, `country_id`, `name`, `status`. Read by `get_country`, `get_state`, and as joins by `member_info`, `track_application`, `know_membership`, `application_data`, `get_application`, `create_order`, `final_step`.

### user_device_data
Anonymous device-token cache. Columns: `device_id`, `created_on`. Written by `device_token_update` (INSERT only — no de-dup).

### activity_log
Generic audit row. Columns: `table_name`, `record_id`, `action_type`, `old_row` (JSON), `new_row` (JSON), `performed_by`, `performed_by_role`, `performed_on`. Written by `logActivity()` helper, called from `member_two` (INSERT) and `member_three` (UPDATE).

### refresh_tokens
Columns: `token` (md5-hashed refresh token). Used only by `refreshToken` handler (not in the 33). Mentioned for completeness.

### tbl_admin
Admin users. Not written by the 33 mobile handlers.

---

## Auth model summary

- **JWT library:** `jsonwebtoken` (`tokenHandler.js`).
- **Secrets:** `process.env.ACCESS_TOKEN_SECRET`, `process.env.REFRESH_TOKEN_SECRET`.
- **Expiry env vars:** `process.env.ACCESS_TOKEN_EXPIRY`, `process.env.REFRESH_TOKEN_EXPIRY` — both parsed as `parseInt(expiry)` (seconds, not "90d" format despite the handler comments).
- **Mobile handlers do NOT use `validate`/`tokenValidation` middleware.** None of the 33 endpoints listed are gated. The `Authorization` header is never checked on them.
- **Tokens are issued** by `check_common_login`, `common_member_otp_verify`, and `check_user_data`. Their `generateToken()` calls are **buggy** — they pass 3 args (`{ email|phone }, secretKey, { expiresIn: '90d' }`) but `generateToken(data, access)` ignores everything past the second param and treats `secretKey` (the string `'amasinc'`) as truthy → always signs with the ACCESS secret regardless. The `{ expiresIn: '90d' }` config is silently dropped; the real expiry comes from `ACCESS_TOKEN_EXPIRY` env. Token payload shape:
  - From `check_common_login`: `{ email: <username> }`
  - From `common_member_otp_verify`: `{ email: <email> }`
  - From `check_user_data`: `{ phone: <username> }` (legacy — `phone` field actually holds the email)
- **Refresh tokens** are stored md5-hashed in `refresh_tokens`. None of the 33 mobile endpoints insert into that table (only legacy admin paths do), so the refresh tokens returned by the mobile login endpoints are signed but never persisted server-side — `/api/refresh` will reject them. Effectively the mobile session = 90d access token only.
- **Password hashing:** md5(!) stored in `tbl_member.password`, with the plaintext also stored in `tbl_member.pass`. No bcrypt or salt on the member side despite `bcrypt` being imported.

---

## Razorpay flow summary

**Two endpoints:** `create_order` (creates order) → mobile client opens Razorpay checkout → on success calls `final_step` with the payment outcome.

### Order creation (`create_order`, controller.js:8875)
- **Trigger:** Mobile POSTs `{ member_id }` to `/api/create_order`.
- **Credentials:** Razorpay key id + secret loaded from `tbl_settings` (NOT env vars). Live secrets in DB.
- **Amount calc:** Server reads `tbl_application` row via member's `application_id`. `amount = fee + (fee * gst_value / 100) + (fee * processing_fee / 100)`. Then multiplied by 100 (paise).
- **Currency:** taken from `tbl_currency_list.currency_code` via join.
- **Receipt format:** `` `receipt#${Date.now()}-${Math.floor(Math.random()*10000)}` ``
- **Razorpay options:** `{ amount, currency, receipt }`. No `notes`, no `transfer` config, no Razorpay Route split (unlike the new Next.js codebase). Single merchant account.
- **Side effect:** `UPDATE tbl_member SET application_status = 10, Razorpay_orderID = <order.id> WHERE id = ?`. Note the column is `Razorpay_orderID` with capital `R`.
- **Response:** `{ status: true, id, currency, amount, receipt }`.

### Verification (`final_step`, controller.js:14181)
**CRITICAL:** There is **no server-side Razorpay signature verification**. The handler trusts the client-supplied `payment_status` string (`"Success"`, `"Failed"`, anything else → status 3 "pending"). The `razorpay_signature` header sent by Razorpay checkout is ignored. `createHmac` is not called anywhere in `controller.js`.

- **Trigger:** Mobile POSTs `{ id, amount, currency, payment_status, payment_id, payment_json }`.
- **Path A — `payment_status == "Success"`:**
  - `UPDATE tbl_member SET application_status = 3, member_reg_date = <now> WHERE id = ?`
  - INSERT `tbl_member_activity` (status=3)
  - Send "Application Submitted Successfully" email via Zepto Mail to applicant
  - Call `sending_mail_to_admin(...)` (admin notification)
  - INSERT `tbl_member_payment` row with `payment_status_val = 1`
- **Path B — `payment_status == "Failed"`:** `payment_status_val = 2`, INSERT payment row, no status update on member.
- **Path C — anything else:** `payment_status_val = 3` (pending), INSERT payment row.
- **Response (all paths):** `{ status: true, message, user_id, application_no }` (200).

### Background reconciliation: `runPaymentVerification()`
Called at the top of `get_application`, `track_application`, `know_membership`, `check_application_status`. Iterates every `tbl_member` row with non-empty `Razorpay_orderID` and `application_status NOT IN (3, 12)`, calls `razorpay.orders.fetchPayments(orderId)`, and if a captured payment exists updates status/inserts payment row server-side (catching missing webhook deliveries). If a `failed` payment exists, sends a "Payment Failed" email. This effectively replaces a webhook. **Important:** any GET on those four endpoints triggers a full-table scan + per-row Razorpay API call. Re-implementing as-is in Next.js will blow rate limits.

---

## Endpoints

### 1. GET /api/settings

**Handler:** `controller.settings` (controller.js:9917)
**Auth:** none
**Request body fields:** none
**MySQL tables touched:**
- `tbl_settings` — read all rows
**Side effects:** none
**Response — success (200):**
```json
{ "status": true, "message": "Get setting data", "data": [ { /* tbl_settings row including logo URL, razor_key_id, razor_key_secret, etc. */ } ] }
```
**Response — error (200):**
```json
{ "status": false, "message": "Something went wrong please try again", "data": [] }
```
**Notes / gotchas:** Returns the **full settings row including `razor_key_secret` and `smtp_password`**. This is a data leak — clients should not see these. The new shim must either (a) replicate verbatim if mobile depends on specific fields, or (b) strip secrets server-side. Routes mounts this as POST with a `multer.single('profile')` middleware (`routes.js:414`) — ignore, the body is unused.

---

### 2. POST /api/device_token_update

**Handler:** `controller.device_token_update` (controller.js:17695)
**Auth:** none
**Request body fields:**
- `device_id` (string) — FCM device token
**MySQL tables touched:**
- `user_device_data` — INSERT (no dedup, no member_id)
**Side effects:** none
**Response — success (200):**
```json
{ "status": true, "message": "Device token added successfully" }
```
**Response — error (200):**
```json
{ "status": false, "message": "Something went wrong" }
```
**Notes / gotchas:** Standalone token table, NOT linked to a member. The `tbl_member.device_id` column is updated separately during `check_common_login` / `common_member_otp_verify`. Every call inserts a new row — table grows unbounded.

---

### 3. POST /api/check_user_data

**Handler:** `controller.check_user_data` (controller.js:19048)
**Auth:** none (issues a JWT in response)
**Request body fields:**
- `username` (string) — member email
- `device_id` (string, optional)
**MySQL tables touched:**
- `tbl_member` — SELECT by email + `application_status=12 AND status=1`; then UPDATE `login_by`, `last_login`, `device_id`
**Side effects:**
- HTTP POST to `https://eventz360.amasi.org/event_user_data` with `{ email }` — populates `event_data` in response
- Issues access_token + refresh_token (JWT, see Auth model)
**Response — success (201):**
```json
{ "status": true, "message": "Login Successfully.", "member": 1, "data": [/* tbl_member rows */], "access_token": "...", "refresh_token": "...", "event": 0, "event_data": [] }
```
or, member not found locally but eventz360 has them:
```json
{ "status": true, "message": "Login Successfully.", "member": 0, "data": [], "event": 1, "event_data": [...] }
```
**Response — error (200):**
```json
{ "status": false, "emailerror": "Invalid username", "passerror": "", "message": "Invalid username" }
```
**Notes / gotchas:** Status code is `201` on success, `200` on error — non-standard. The inner password branch (`'Invalid password'`) is **dead code** in this handler — `check_user_data` is the "OTP login" variant of `check_common_login`. There's no password check; the email alone (matched against an active LM with status 12) is sufficient to log in. Returns the **full member row** in `data`. The `'Login Successfully.'` literal with trailing period is part of the client contract.

---

### 4. POST /api/check_common_login

**Handler:** `controller.check_common_login` (controller.js:17920)
**Auth:** none (issues JWT)
**Request body fields:**
- `username` (string) — email
- `password` (string)
- `device_id` (string, optional)
**Request header:** `x-source` (defaults to `"website"`) — written to `tbl_member.login_by`
**MySQL tables touched:**
- `tbl_member` — SELECT by email + status=12 + status=1; then SELECT by email + md5(password); UPDATE `login_by`, `last_login`, `device_id`
**Side effects:**
- POST `https://eventz360.amasi.org/eventlogin` with `{ email, password, mem }` — cross-checks event app
- Issues JWT (see Auth model)
**Response — success (201):** identical envelope to #3 above (with `data`, `access_token`, `refresh_token`, `event`, `event_data`).
**Response — bad password (200):**
```json
{ "status": false, "emailerror": "", "passerror": "Invalid password", "message": "Invalid password" }
```
**Response — bad email (200):**
```json
{ "status": false, "emailerror": "Invalid username", "passerror": "", "message": "Invalid username" }
```
**Notes / gotchas:** md5 password hashing. Same broken `generateToken` 3-arg call as #3.

---

### 5. POST /api/common_member_send_otp

**Handler:** `controller.common_member_send_otp` (controller.js:18056)
**Auth:** none
**Request body fields:**
- `email` (string)
**MySQL tables touched:**
- `tbl_member` — SELECT by email + `application_status=12 AND status=1`; UPDATE `otp`, `otp_verify=0`, `otp_time`
**Side effects:**
- If member not found locally → POST `https://eventz360.amasi.org/eventsendotp` with `{ email, otp }`. eventz360 handles delivery for non-LM users.
- If member found → Zepto Mail (`smtp.zeptomail.com:587`, env `ZEPTO_MAIL_USERNAME`, `ZEPTO_MAIL_PASS`, `ZEPTO_MAIL_SENDER`, `replyTo`) sends OTP HTML to `email`. Subject (inferred from common pattern): "Verify Your Email Address".
**Response — success (200):**
```json
{ "status": true, "message": "OTP send your mail", "data": { /* req.body */ }, "userid": <tbl_member.id> }
```
**Response — account not found (200):**
```json
{ "status": false, "message": "Account not found" }
```
**Notes / gotchas:** 4-digit numeric OTP, 3-minute expiry (NOT 10 minutes despite email template wording). Eventz360 fallback path means a successful "OTP sent" can mean either local LM or remote eventz360 user — clients must store the `userid` for the verify step (0 for eventz360 path? actually not returned at all on eventz360 path — clients infer from absence).

---

### 6. POST /api/common_member_resend_otp

**Handler:** `controller.common_member_resend_otp` (controller.js:18488)
**Auth:** none
**Request body fields:**
- `id` (number) — tbl_member.id
- `email` (string)
**MySQL tables touched:**
- `tbl_member` — SELECT by `id AND status=1`; UPDATE `otp`, `otp_verify=0`, `otp_time`
**Side effects:**
- If id not found → POST `https://eventz360.amasi.org/eventsendotp` (same eventz360 fallback)
- Else → Zepto Mail OTP email
**Response — success (200):**
```json
{ "status": true, "message": "OTP send your mail", "data": { /* req.body */ }, "userid": <id> }
```
or eventz360 path: `{ status: true, message: "OTP send your mail", data: <response.data from eventz360> }`
**Response — error (200):** `{ status: false, message: "Account not found" }`

---

### 7. POST /api/common_member_otp_verify

**Handler:** `controller.common_member_otp_verify` (controller.js:18912)
**Auth:** none (issues JWT on success)
**Request body fields:**
- `id` (number)
- `email` (string)
- `otp` (string, 4 digits)
- `device_id` (string, optional)
**Request header:** `x-source` (defaults `"website"`)
**MySQL tables touched:**
- `tbl_member` — SELECT by `id AND status=1`; UPDATE `otp`, `otp_verify=1`, `last_login`, `login_by`, `device_id`
**Side effects:**
- If member not found locally → POST `https://eventz360.amasi.org/event_user_verify_otp` with `{ email, otp }`; on success, returns eventz360's user data
- Else → POST `https://eventz360.amasi.org/event_user_data` to enrich `event_data` in response, then issues JWT
**Response — success (200, local LM):**
```json
{ "status": true, "message": "OTP Verified Successfully", "access_token": "...", "refresh_token": "...", "member": 1, "userid": <id>, "data": [/* tbl_member rows */], "event_data": [...], "event": 0|1 }
```
**Response — success (200, eventz360 user):**
```json
{ "status": true, "message": "<eventz360 message>", "member": 0, "userid": 0, "data": [], "event": 1, "event_data": [...] }
```
**Response — OTP expired (200):** `{ "status": false, "message": "OTP has expired" }`
**Response — invalid OTP (201):** `{ "status": false, "message": "Invalid OTP" }`
**Notes / gotchas:** OTP expiry is 3 minutes (`moment(currentDate).diff(otpTime, 'minutes') > 3`). The `Invalid OTP` response uses status code **201** not 200/4xx. The local-success path drops through `if (drow1.affectedRows > 0)` but has no else — if the UPDATE somehow returns 0 affected rows the handler simply hangs (no response sent). Shim should `return` explicitly even on this branch.

---

### 8. POST /api/memberforgotpassword

**Handler:** `controller.memberforgotpassword` (controller.js:17415)
**Auth:** none
**Request body fields:**
- `email` (string)
**MySQL tables touched:**
- `tbl_member` — SELECT by email
**Side effects:**
- Generates an AES-256-CBC encrypted token of `member.id`. Encryption key is **hardcoded in code** (controller.js:44): `"amasihp-pro123456789123456789012"`. IV is random per process start (module-level `randomBytes(16)`) so it's reused across all calls — broken IV reuse.
- Sends Zepto Mail with reset link `${baseUrl}/application/user-change-password?<encrypted_token>`
**Response — success (201):** `{ "status": true, "message": "Mail Send Successfully" }`
**Response — email not found (200):** `{ "status": false, "message": "Invalid email" }`
**Response — mail error (201):** `{ "status": false, "message": "Something went wrong", "error": <smtp error> }`
**Notes / gotchas:** AES IV reuse + hardcoded key + the IV is prepended to the ciphertext anyway as `${iv}:${encryptedData}` — anyone can decrypt the token offline. Tactical fix in the shim: switch to signed JWT reset token with short TTL.

---

### 9. POST /api/mobile_notification_list

**Handler:** `controller.mobile_notification_list` (controller.js:9851)
**Auth:** none (member_id supplied by client — no auth check that it's actually yours)
**Request body fields:**
- `member_id` (number)
**MySQL tables touched:**
- `tbl_notification` (JOIN `tbl_member.first_name`) — read
**Side effects:** none
**Response — success (201):**
```json
{ "status": true, "message": "Notification list.", "data": [ { /* tbl_notification row + first_name */ } ], "notification_count": <count of unread (read_status=1)> }
```
**Notes / gotchas:** `read_status=1` means **unread** per query (`COUNT(*) AS read_count WHERE read_status = 1`), but the JSON field is `notification_count`. Naming is inverted vs the column. `read_status=2` means read. Status code 201.

---

### 10. POST /api/mobile_notification_all_read

**Handler:** `controller.mobile_notification_all_read` (controller.js:9900)
**Auth:** none
**Request body fields:** `member_id` (number)
**MySQL tables touched:**
- `tbl_notification` — UPDATE `read_status=2 WHERE member_id=?`
**Side effects:** none
**Response — success (200):** `{ "status": true, "message": "Read Status update successfully" }`

---

### 11. POST /api/mobile_notification_status_update

**Handler:** `controller.mobile_notification_status_update` (controller.js:9883)
**Auth:** none
**Request body fields:** `id` (number) — `tbl_notification.id`
**MySQL tables touched:**
- `tbl_notification` — UPDATE `read_status=2 WHERE id=?`
**Side effects:** none
**Response — success (200):** `{ "status": true, "message": "Read Status update successfully" }`

---

### 12. POST /api/enquiry_form

**Handler:** `controller.enquiry_form` (controller.js:11799)
**Auth:** none
**Request body fields:**
- `first_name`, `last_name`, `email_id`, `mobile_number`, `member_no`, `subject`, `message` (all strings)
**MySQL tables touched:**
- `tbl_enquiry_form` — INSERT
**Side effects:** none (no email is sent from this endpoint — admin replies use a separate endpoint not in the 33)
**Response — success (200):** `{ "status": true, "message": "Thank you for your submission", "data": { /* req.body */ } }`
**Response — error (200):** `{ "status": false, "message": "A network error occurred, or the server is temporarily busy. Please try again later" }`

---

### 13. POST /api/know_membership

**Handler:** `controller.know_membership` (controller.js:11692)
**Auth:** none
**Request body fields:**
- `email` (string, empty if searching by mobile)
- `mobile` (string, empty if searching by email)
**MySQL tables touched:**
- `tbl_member` (JOIN `countries`, `states` x3 incl. `mci_council_state`+`asi_state`, `tbl_status_master`) — read
- `tbl_member_payment` (JOIN `tbl_payment_status`) — read
- All `tbl_member` rows with non-final status get scanned by `runPaymentVerification()` first — full-table Razorpay reconciliation
**Side effects:** `runPaymentVerification()` may UPDATE `tbl_member` rows + INSERT `tbl_member_payment` rows for any member with pending payments (not just the queried one).
**Response — member exists with membership_no (200):**
```json
{ "status": true, "message": "Member number Allocated", "data": [/* member row */], "payment_status": [...] }
```
**Response — application under review (200):**
```json
{ "status": true, "message": "Application under review. ", "data": [...], "payment_status": [] }
```
**Response — draft only (200):**
```json
{ "status": true, "message": "Application already exits not completed", "data": [...], "payment_status": [] }
```
**Response — not found (200):** `{ "status": false, "message": "Email or Phone not validate" }` or `{ "status": false, "message": "Application and email id not validate" }` (which one depends on the branch reached; verifier must mimic exactly).
**Notes / gotchas:** The handler reads `email` and `mobile` as `if (email !== "")` — so client must send `""` (not omit) for the unused field. If both are empty `user_rows` is undefined and the handler crashes with `Cannot read 'length' of undefined`.

---

### 14. POST /api/send_details_toMail

**Handler:** `controller.send_details_toMail` (controller.js:11876)
**Auth:** none
**Request body fields:** `id` (number) — `tbl_member.id`
**MySQL tables touched:**
- `tbl_member` — SELECT by `id AND status=1`
**Side effects:** Sends "Member Details" Zepto Mail to the member with their info table rendered as HTML.
**Response — success (200):** `{ "status": true, "message": "Mail Send Successfully" }`
**Response — missing id (200):** `{ "status": false, "message": "Enquiry Form is Required" }` (message text is misleading — actually missing id)
**Response — mail send error (201):** `{ "status": false, "message": "Something went wrong", "error": <smtp error msg> }`

---

### 15. POST /api/member_info

**Handler:** `controller.member_info` (controller.js:13613)
**Auth:** none
**Request body fields:**
- `id` (number, optional) OR `application_no` (string, optional) — one of the two
**MySQL tables touched:**
- `tbl_member` (LEFT JOIN `countries`, `states` x3, `tbl_status_master`, `tbl_application`) — read
- `tbl_clinic_address` (LEFT JOIN `countries`, `states`) — read
- `tbl_work_exp` — read
- `tbl_member_payment` (JOIN `tbl_payment_status`) — read
- `tbl_fmas` — read; if found, `tbl_fmas_certificate` — read (filtered by `year_of_convocation`)
**Side effects:** none
**Response — success (201):**
```json
{
  "status": true, "message": "Member Info.",
  "data": [/* enriched member row */],
  "clinic": [...],
  "work_exp": [...],
  "payment_status": [...],
  "fmas_data": [...]
}
```
**Notes / gotchas:** Mounted on `cpUpload1` multipart middleware (`routes.js:613`) but the handler doesn't use files. The handler crashes if member with given id/application_no doesn't exist (no length check before `row[0].id`). Status code 201, not 200.

---

### 16. POST /api/track_application

**Handler:** `controller.track_application` (controller.js:11581)
**Auth:** none
**Request body fields:**
- `application_no` (string)
- `email` (string)
**MySQL tables touched:** identical to `know_membership`. Also triggers `runPaymentVerification()`.
**Side effects:** same as `know_membership`.
**Response — same set of envelopes as `know_membership`** but message texts differ slightly. Member-allocated branch returns `"Member number Allocated"`. Under-review returns `"Application under review. "` (note trailing space). Draft returns `"Application already exits not completed"` [sic]. Not-found returns `{ status: false, message: "Application and email id not validate" }`.

---

### 17. POST /api/get_member_activity

**Handler:** `controller.get_member_activity` (controller.js:8832)
**Auth:** none
**Request body fields:** `member_id` (number)
**MySQL tables touched:**
- `tbl_member_activity` (LEFT JOIN `tbl_status_master`) — read
**Side effects:** none
**Response — success (201):**
```json
{ "status": true, "message": "Activity notes list.", "data": [ { /* activity row + status_name */ } ] }
```
**Notes / gotchas:** Uses string concat `where member_id=${member_id}` (SQL injection). Status 201.

---

### 18. GET /api/get_country

**Handler:** `controller.get_country` (controller.js:4175)
**Auth:** none
**Request:** none
**MySQL tables touched:**
- `countries` — SELECT WHERE `status=1 ORDER BY country_name ASC`
**Response — success (201):**
```json
{ "status": true, "message": "Country list.", "data": [ { /* country */ } ] }
```

---

### 19. POST /api/get_state

**Handler:** `controller.get_state` (controller.js:4277)
**Auth:** none
**Request body fields:** `id` (number, optional) — country_id; defaults to `101` (India) if missing/empty
**MySQL tables touched:**
- `states` — SELECT WHERE `status=1 AND country_id=<id>` ORDER BY `name ASC`
**Response — success (201):**
```json
{ "status": true, "message": "States list.", "data": [ { /* state */ } ] }
```
**Notes / gotchas:** `country_id=${id}` is string-concatenated → SQL injection.

---

### 20. GET /api/get_application

**Handler:** `controller.get_application` (controller.js:4974)
**Auth:** none
**Request:** none
**MySQL tables touched:**
- `tbl_application` (LEFT JOIN `tbl_gst_type`, `tbl_gst`, `tbl_currency_list`, `tbl_member`) — read with `application_count` per type (count of `application_status=12` members)
**Side effects:** `runPaymentVerification()` runs first — full-table scan.
**Response — success (201):**
```json
{ "status": true, "message": "Application list.", "data": [
  { /* application row */, "gstAmount": <number>, "processingAmount": <number>, "totalPrice": <number> }
]}
```
**Notes / gotchas:** Each call triggers full reconciliation. Re-implementing as-is will fan out to one Razorpay API request per pending member, per call.

---

### 21. POST /api/send_otp

**Handler:** `controller.send_otp` (controller.js:12688)
**Auth:** none
**Request body fields:**
- `first_name`, `last_name`, `email`, `mobile_code`, `mobile`, `membership_no`, `application_id`
**MySQL tables touched:**
- `tbl_member` — SELECT by email; if exists: UPDATE `application_id` (if supplied), `otp`, `otp_verify=0`, `otp_time`. If not exists: INSERT new draft row with `application_id`, `first_name`, `last_name`, `email`, `mobile_code`, `mobile`, `otp`, `otp_time`.
**Side effects:**
- Zepto Mail OTP HTML to `email`. Subject `"Verify Your Email Address "`.
**Response — success (200, existing email):** `{ status: true, message: "OTP send your mail", data: <req.body>, userid: <existing tbl_member.id> }`
**Response — success (200, new draft):** `{ status: true, message: "OTP send your mail", message1: "insert", data: <req.body>, userid: <result.insertId> }`
**Response — mail error (201):** `{ status: false, message: "Something went wrong", error }`
**Notes / gotchas:** This is the new-application OTP send (different from `common_member_send_otp` which is login). Note the additional `message1: "insert"` field that clients use to detect the create-vs-update branch. **Email is lowercased** but first/last names are title-cased (first char upper, rest lower) before INSERT.

---

### 22. POST /api/otp_verify

**Handler:** `controller.otp_verify` (controller.js:13143)
**Auth:** none
**Request body fields:**
- `id` (number — tbl_member.id)
- `otp` (string, 4 digits)
- `application_id` (number, optional)
**MySQL tables touched:**
- `tbl_member` — SELECT by id; UPDATE `otp`, `otp_verify=1`
- Plus `ensureMemberApplicationNo()` may UPDATE `application_id`, `application_no`, `application_no_without_letter` (atomically under `GET_LOCK('application_no_<applicationId>', 10)`).
**Side effects:** none beyond the lock dance
**Response — success (200):**
```json
{ "status": true, "message": "OTP Verified Successfully", "userid": <id>, "application_id": <number|null>, "application_no": <string|null> }
```
**Response — expired (200):** `{ "status": false, "message": "OTP has expired" }`
**Response — invalid OTP (201):** `{ "status": false, "message": "Invalid OTP" }`
**Response — member not found (200):** `{ "status": false, "message": "Member not found" }`
**Notes / gotchas:** OTP expiry is 3 minutes. The application_no assignment logic uses `GET_LOCK` + `SELECT MAX(application_no_without_letter)+1`, defaulting to `APPLICATION_NO_START=14700`. Prefix is derived from `tbl_application.application_name` via `getApplicationNoPrefix` (matches `[XX]` bracket, then Associate Life Member→ALM, International Life Member→ILM, Associate Candidate Member→ACM, Life Member→LM, else first letter). The Postgres-equivalent in the new app uses a sequence; here it's a MAX scan inside a MySQL named lock.

---

### 23. POST /api/resend_otp

**Handler:** `controller.resend_otp` (controller.js:13216)
**Auth:** none
**Request body fields:** `id` (number)
**MySQL tables touched:**
- `tbl_member` — SELECT by id; UPDATE `otp`, `otp_verify=0`, `otp_time` via string concat (SQLi)
**Side effects:** Zepto Mail OTP email
**Response — success (200):** `{ "status": true, "message": "OTP send your mail", "data": <req.body>, "userid": <id> }`
**Response — mail error (201):** `{ status: false, message: "Something went wrong", error }`
**Notes / gotchas:** If member not found OR UPDATE returns 0 affected rows, **the handler returns nothing** — request hangs until client times out. Shim must explicitly return an error.

---

### 24. POST /api/check_application_status

**Handler:** `controller.check_application_status` (controller.js:12559)
**Auth:** none
**Request body fields:**
- `first_name`, `last_name`, `email`, `mobile`, `membership_no` (all strings; `membership_no` optional)
**MySQL tables touched:**
- `tbl_member` — SELECT (string-concat SQLi) by email; optionally re-SELECT by `email AND membership_no` for membership verification.
**Side effects:** `runPaymentVerification()` runs first.
**Response — membership verified (200):**
```json
{ "status": true, "message": "Member number is verified", "data": <req.body>, "userid": ..., "application_id": ..., "application_status": "NO" }
```
**Response — membership wrong (200):** `{ status: false, message: "Member number is wrong. " }` (trailing space)
**Response — email exists + status 12 (200):** `{ status: false, err_type: 1, message: "Email already exists. " }`
**Response — status 6/7/9 (200) — "New" branch:** `{ status: true, message: "New", data: <req.body>, application_id: "", application_status: "NO" }`
**Response — status 10 (200):** `{ status: true, message: "Application already exits", data, userid, application_id, application_status: "YES" }`
**Response — other status (200):** `{ status: false, message: "Application under review. " }`
**Response — status 0 (draft) (200):** `{ status: true, message: "Application already exits", data, userid, application_id, application_status: "YES" }`
**Response — no match (200):** `{ status: true, message: "New", data: <req.body>, application_id: "", application_status: "NO" }`
**Notes / gotchas:** **The exact `application_status` enum branches matter** — clients almost certainly switch on the string literal "YES"/"NO"/"" and the `message` text. Replicate verbatim including trailing spaces. `err_type: 1` only appears in one branch.

---

### 25. POST /api/delete_clinic

**Handler:** `controller.delete_clinic` (controller.js:7922)
**Auth:** none
**Request body fields:** `id` (number — tbl_clinic_address.id)
**MySQL tables touched:**
- `tbl_clinic_address` — hard DELETE
**Side effects:** none
**Response — (201):** `{ "status": true, "message": "You have been successfully deleted" }`
**Notes / gotchas:** No ownership check — any client can delete any clinic by id.

---

### 26. POST /api/delete_work_exp

**Handler:** `controller.delete_work_exp` (controller.js:7941)
**Auth:** none
**Request body fields:** `id` (number)
**MySQL tables touched:**
- `tbl_work_exp` — hard DELETE
**Response — (201):** `{ "status": true, "message": "You have been successfully deleted" }`
**Notes / gotchas:** No ownership check.

---

### 27. POST /api/delete_old_member_application

**Handler:** `controller.delete_old_member_application` (controller.js:12671)
**Auth:** none
**Request body fields:** `id` (number — tbl_member.id)
**MySQL tables touched:**
- `tbl_member` — hard DELETE (NOT soft-delete via `status=0`; this one wipes the row)
**Response — (201):** `{ "status": true, "message": "You have been successfully deleted" }`
**Notes / gotchas:** **Destructive.** No ownership check, no audit trail, no FK cascade handling (orphans rows in `tbl_clinic_address`, `tbl_work_exp`, `tbl_member_payment`, `tbl_member_activity`).

---

### 28. POST /api/member_two

**Handler:** `controller.member_two` (controller.js:13777)
**Auth:** none
**Request body fields:**
- `id`, `application_id`, `salutation`, `first_name`, `last_name`, `middle_name`, `father_name`, `dob` (ISO date or YYYY-MM-DDTHH:mm:ss; `.split('T')[0]` is applied), `age`, `nationality`, `gender`, `street_line1`, `street_line2`, `country`, `state`, `city`, `pin`, `zone`, `landline`, `stdcode`, `mailing_address`
- **Clinic arrays (parallel by index):** `clinic_name[]`, `clinic_address_one[]`, `clinic_address_two[]`, `clinic_country[]`, `clinic_state[]`, `clinic_city[]`, `clinic_pin_code[]`, `clinic_stdcode[]`, `clinic_landline[]`, `clinic_mailing_address[]`, `clinic_id[]` (optional — if set per index → UPDATE; else INSERT)
**Request files (multipart, all optional):**
- `profile`, `mci_certificate`, `pg_degree_certificate`, `asi_member_certificate`, `active_license`, `letter_hod`, `mbbs_degree_certificate`
- File URLs are surfaced via `req.fileUrls[<fieldname>]` after the route-level S3 upload to `member2025` bucket under `certificates/${Date.now()}_${originalname}` (`routes.js:617-633`). The legacy local upload path is wiped after.
**MySQL tables touched:**
- `tbl_member` — UPDATE personal/address/file columns. Two separate UPDATEs (one for personal fields, one for file columns built dynamically based on which `req.fileUrls` keys are present). Old file URLs are preserved if no new upload for that field.
- `tbl_clinic_address` — INSERT or UPDATE per index in arrays
- `activity_log` — INSERT via `logActivity()` (actionType `"INSERT"` — wrong, should be UPDATE)
- `tbl_application` indirectly via `ensureMemberApplicationNo()` may also rewrite `application_no`
**Side effects:**
- S3 uploads happen in route middleware before the handler runs (per field, sequentially — slow with 7 files).
**Response — success (200):**
```json
{ "status": true, "message": "Member updated successfully", "user_id": <id>, "application_no": <string|null> }
```
**Notes / gotchas:**
- File-update loop **keeps old URL if `req.fileUrls[field]` is falsy** — so omitting a file leaves it untouched.
- `last_name`, `middle_name`, `father_name` are title-cased before UPDATE; `first_name` is NOT touched here (`first_name` is set during `send_otp`).
- `clinic_id` is the multipart-field key for the optional id-per-row; clients sending text arrays via multipart need to use either repeated keys or `clinic_name[]`. The handler uses `clinic_name.length` as loop bound — if `clinic_name` is a single string (not array), iterating `.length` yields character indexing. Shim must coerce singletons to arrays.
- Empty string `dob` will crash `.split('T')[0]` on undefined → handle defensively.

---

### 29. POST /api/member_three

**Handler:** `controller.member_three` (controller.js:14005)
**Auth:** none
**Request body fields:**
- `id`, `application_id`, `edu_undergrad_degree`, `edu_undergrad_college`, `edu_undergrad_university`, `edu_undergrad_year`, `edu_postgrad_*` (degree/college/university/year), `edu_superspecialty_*`, `mci_council_number`, `mci_council_state`, `imr_reg_no`, `asi_membership_no`, `asi_state`, `other_inter_organisation`, `other_inter_organisation_value`
- **Work experience arrays (parallel by index):** `work_procedure[]`, `exp_in_year[]`, `no_of_procedures1[]`, `no_of_procedures2[]`, `work_exp_id[]` (optional — set per index → UPDATE; else INSERT)
**Request files (multipart, all optional):** same 7 fields as `member_two`
**MySQL tables touched:**
- `tbl_member` — UPDATE education/regulatory columns + file columns
- `tbl_work_exp` — INSERT or UPDATE per index
- `activity_log` — INSERT via `logActivity()` actionType "UPDATE"
**Side effects:** S3 uploads (same path as member_two).
**Response — success (200):**
```json
{ "status": true, "message": "Member updated successfully", "user_id": <id>, "application_no": <string|null> }
```
**Notes / gotchas:**
- The `..._year` fields are coerced: `(year === "" || year === "null") ? null : year`. Watch for the literal string `"null"`.
- `register_by` is overwritten with `x-source` header on every call.
- Same array-coercion concerns as `member_two`.

---

### 30. POST /api/create_order

**Handler:** `controller.create_order` (controller.js:8875)
**Auth:** none
**Request body fields:** `member_id` (number)
**MySQL tables touched:**
- `tbl_member` — SELECT (string-concat); UPDATE `application_status=10`, `Razorpay_orderID`
- `tbl_application` (JOIN gst/currency tables) — read fee/gst/processing_fee
- `tbl_settings` — read razor_key_id, razor_key_secret
**Side effects:** Razorpay SDK call `razorpay.orders.create({ amount, currency, receipt })`. Amount is `(fee + gstAmount + processingAmount) * 100` (paise).
**Response — success (200):**
```json
{ "status": true, "id": "<order_xxx>", "currency": "INR", "amount": <number in major units>, "receipt": "receipt#<ts>-<rand>" }
```
**Response — member not found (200):** `{ "status": false, "message": "Member not found" }`
**Notes / gotchas:**
- The Razorpay `amount` field returned is the JS-multiplied major-unit amount (not paise) — clients should multiply by 100 again for Razorpay checkout… or the legacy mobile client already knows the convention. Replicate verbatim.
- **No Razorpay Route transfer split** (unlike the new Next.js codebase).
- **No idempotency guard.** Repeated calls create new orders and overwrite `Razorpay_orderID`. Old order remains as a Razorpay zombie.

---

### 31. POST /api/final_step

**Handler:** `controller.final_step` (controller.js:14181)
**Auth:** none
**Request body fields:**
- `id` (tbl_member.id)
- `amount` (number)
- `currency` (string)
- `payment_status` (string — `"Success"` / `"Failed"` / anything else=pending)
- `payment_id` (Razorpay payment id, optional)
- `payment_json` (object — full Razorpay handler response, serialized server-side via `JSON.stringify`)
**MySQL tables touched:**
- `tbl_member` — UPDATE `application_status=3, member_reg_date` (only on Success path); `ensureMemberApplicationNo()` may also update application_no
- `tbl_member_activity` — INSERT (status=3 on Success)
- `tbl_member_payment` — INSERT
- `tbl_application` + gst/currency joins — read for invoice rendering
**Side effects (Success path only):**
- Zepto Mail to applicant — Subject `"Application Submitted Successfully"`. Contains invoice details.
- `sending_mail_to_admin(...)` — additional Zepto Mail to amasi admin
**Response — success (200):**
```json
{ "status": true, "message": "Member updated successfully", "user_id": <id>, "application_no": <string> }
```
**Response — member not found (200):** `{ "status": false, "message": "Member not found" }`
**Notes / gotchas:**
- **NO Razorpay signature verification.** `razorpay_signature` is not read, no `createHmac` call. Client could POST `payment_status: "Success"` with a bogus `payment_id` and the server marks the application as approved. Background `runPaymentVerification()` will not re-validate Success rows (it filters them out via `application_status != 3`), so the fraud is permanent.
- Email + admin notification can fail silently (only the smtp error is logged); the DB write already succeeded.

---

### 32. POST /api/application_data

**Handler:** `controller.application_data` (controller.js:10123)
**Auth:** none
**Request body fields:** `application_no` (string)
**MySQL tables touched:**
- `tbl_member` (JOIN `countries`, `states`, `tbl_status_master`) — read
- `tbl_member_payment` (JOIN `tbl_payment_status`) — read latest 1 row
- `tbl_application` (JOIN gst/currency) — read
**Side effects:** none
**Response — success (200):**
```json
{
  "status": true, "message": "Application Data",
  "data": [/* member row */],
  "payment_status": [/* single payment row */],
  "application_data": [/* application row + gstAmount, processingAmount, totalPrice */],
  "webaddress": "45 A Pankaja Mill Road, Ramanathapuram, Coimbatore, Tamil Nadu 641045, IN",
  "webphone": "+914224223330",
  "webemail": "amasi.india@gmail.com",
  "webgst": "33AAAA6705D1ZF"
}
```
**Response — not found (200):** `{ "status": false, "message": "No data found" }`
**Notes / gotchas:** The address/phone/email/GST are **hardcoded in the handler** (not from `tbl_settings`). Shim must return these exact strings — clients almost certainly render them on invoices.

---

### 33. POST /api/member_conversion

**Handler:** `controller.member_conversion` (controller.js:5072)
**Auth:** none
**Request body fields:**
- `id` (tbl_member.id of the existing member being upgraded)
- `application_id` (5 or 6 — see mapping below)
- `membership_no` (string — used as WHERE clause; conversion finds the row by membership_no, not id)
- `asi_membership_no` (string)
- `asi_state` (id)
**Request files (multipart, all optional):** same 7 file fields
**MySQL tables touched:**
- `tbl_member` — UPDATE `application_id=<1>`, `application_status=3`, `member_reg_date`, `asi_membership_no`, `asi_state` WHERE `membership_no = ?`; also file-column UPDATE by id
- `tbl_member_log` — INSERT (snapshot pre-conversion `member_id` + `m_application_id`)
- `tbl_member_activity` — INSERT two rows (status_master then 3)
**Side effects:** Zepto Mail "Application Submitted Successfully" to applicant.
**Response — success (200):**
```json
{ "status": true, "message": "Conversion updated successfully", "user_id": <mem_row.id>, "application_no": <mem_row.application_no> }
```
**Notes / gotchas:**
- **Application_id mapping is hardcoded:** `5 → application_id_new=1, status_master=17`; `6 → application_id_new=1, status_master=18`. Other values yield `null` → SQL fails. So this endpoint **only** handles two upgrade paths: ASI-to-LM (5) and ALM-to-LM (6, presumably). Replicate the mapping verbatim.
- Conversion UPDATE uses `WHERE membership_no=?` — silently no-ops if `membership_no` is empty/wrong.

---

## Security notes

This is a partial list. The legacy codebase is full of issues; only the structural ones that affect the shim are flagged here.

1. **SQL injection (pervasive).** String-concatenated SQL with `${var}` is the norm, not the exception. Affected handlers in the 33: `send_otp`, `otp_verify`, `resend_otp`, `check_application_status`, `application_data`, `track_application`, `know_membership` (mostly parameterised but the inner sub-queries concat), `member_info`, `member_two`, `member_three`, `final_step`, `create_order`, `member_conversion`, `get_state`, `get_member_activity`, `delete_member_account`, `check_common_login`, `common_member_send_otp`, `common_member_resend_otp`, `common_member_otp_verify`, `check_user_data`. The shim should use parameterised queries (or an ORM) end-to-end.

2. **No Razorpay signature verification on `final_step`.** Client tells server "payment was successful" and server believes it. Real fix in the new Next.js codebase is server-side HMAC verification with `razorpay_payment_id|razorpay_order_id` against the secret. Don't carry the legacy behavior forward.

3. **Razorpay credentials stored in MySQL (`tbl_settings.razor_key_secret`)** and **returned in the `GET /settings` response**. The shim should at minimum strip secrets from the response; long-term, move secrets to env.

4. **MD5 password hashing + plaintext password column** (`tbl_member.password` md5, `tbl_member.pass` plaintext). Both fields are written in tandem in every password-change path. Migrate to bcrypt during cutover.

5. **Hardcoded AES-256-CBC key for password-reset tokens:** `const key = "amasihp-pro123456789123456789012"` (controller.js:44). IV is module-level random, so it's **reused across every encryption call** until process restart. The IV is prepended to the ciphertext in the token anyway, making the encryption decorative. Anyone who can read code on GitHub can forge a password-reset token. Replace with signed JWT (short TTL).

6. **JWT `generateToken()` is called with 3-4 args by mobile login handlers** (`generateToken({email|phone}, secretKey, {expiresIn:'90d'}, isAccess?)`) but the function only accepts `(data, access)` — every extra arg is silently dropped. Tokens still sign but with the wrong intent. `ACCESS_TOKEN_EXPIRY` env (parsed as int seconds) controls expiry, NOT `'90d'`. Shim must decide: replicate the buggy 90-day-ish expiry, or fix it.

7. **No authorization on destructive endpoints.** `delete_clinic`, `delete_work_exp`, `delete_old_member_application` accept an `id` from any caller and delete by it — no member-id check, no JWT, no ownership verification. `delete_old_member_application` is a hard DELETE; the other two delete child rows. The shim **must** add `getMemberSession()` ownership checks.

8. **No authorization on read endpoints.** `member_info`, `mobile_notification_list`, `application_data`, `get_member_activity` accept a `member_id`/`id`/`application_no` and dump the full row to anyone. PII (DOB, address, MCI/IMR numbers, parents' names, certificate URLs) is leaked. Compounded by Issue 9.

9. **All S3 URLs are public.** Bucket `member2025` (region `ap-south-1`) is referenced directly via `https://member2025.s3.ap-south-1.amazonaws.com/certificates/...`. URLs are stored in `tbl_member` and returned in API responses. Anyone with a URL has the document.

10. **Eventz360 cross-call has no signed token.** `curlRequest()` to `https://eventz360.amasi.org/eventlogin`, `/eventsendotp`, `/event_user_verify_otp`, `/event_user_data` just POSTs JSON with no auth header. Trust between the two services is by network/origin only. Migration cutover may need an API key.

11. **Swallowed errors / handler hangs.** Several handlers (`otp_verify`, `resend_otp`, `common_member_otp_verify`) have branches where no response is sent (e.g. `if (drow1.affectedRows > 0)` with no else). Client waits for socket timeout. Shim must add explicit error returns on every branch.

12. **Hardcoded company address in `application_data` response** (controller.js:10226-10230). If AMASI relocates, two places must change (the handler + the email template literals). The shim should source these from `tbl_settings` (and add them as columns if missing).

13. **`runPaymentVerification()` does a full-table scan + per-row Razorpay API call on every read of `get_application`/`track_application`/`know_membership`/`check_application_status`.** As the member table grows this becomes a DoS vector. The shim should rate-limit or move reconciliation to a scheduled job + webhook (which the new Next.js codebase already has).

14. **Status code inconsistency.** Mix of 200/201 with `status: false` in body. Real HTTP errors (4xx/5xx) are essentially never used. The 422 `validate` middleware path is dead-coded for the mobile endpoints. Clients **must** ignore HTTP status and key off the `status` boolean — replicate exactly.

15. **`pass` plaintext column survives every password change.** When sending the auto-generated admin invite email (`add_user`), the plaintext password is included in the email body. Not in the 33 mobile endpoints, but the same pattern is used in `member_forgot_pass_update` / `member_change_password`.
