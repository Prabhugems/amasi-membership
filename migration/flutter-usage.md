# Flutter app endpoint usage audit

Source: `/Users/prabhubalasubramaniam/AMASI-Mobile-blazingcoders/lib/` (68 .dart files, ApiService = Dio FormData, EventApiService = Dio FormData against `eventBaseUrl`).
Base URL in production code: `https://membership.amasi.org/api/` (`lib/main.dart:27`). All `ApiService().post()` calls wrap the payload in `FormData.fromMap()` and send `Content-Type: multipart/form-data` + custom header `X-Source: mobile-app` (`lib/api/api_service.dart:50`).

## Critical decisions

### 1. Password auth alive? YES — wired.

Endpoint `check_common_login` is the live POST handler for the password tab on the login screen.

- Call site: `lib/view/login_ext/login.dart:118` inside `_submitForm()` (the "LOGIN" button), reachable when the user taps the **"Login Password"** toggle button at `lib/view/login_ext/login.dart:258`. The toggle is mutually exclusive with the OTP toggle at line 247.
- Payload: `{username, password, device_id}` (login.dart:113-115). Response is parsed via `LoginModel` (`lib/Models/login_model.dart`): consumed fields are `status`, `message`, `member`, `data[0].{id, application_id, membership_no, first_name, email, profile, application_status}`, `event`, `event_data[0].{id, first_name, email}`, `access_token`.
- The "Login Password" toggle is the default tab on first render (`_isOtpLogin = false` at login.dart:18). Password auth is the primary user-visible entry, not OTP. **Cannot drop without screen change.**

### 2. Settings response — used (Razorpay key is dynamic).

The `/settings` response IS used at runtime, and the Razorpay key from the response IS the key passed to `razorpay_flutter`'s `Razorpay().open(options)`.

- `lib/Controller/Settings_Controller.dart:23` calls `settingScreen("settings")` from `onInit()`. Result parsed via `SettingModel` (`lib/Models/setting_model.dart`).
- Stored as instance fields `logo, websiteName, email, phone, razorKeyId, webAddress` (Settings_Controller.dart:35-40). Response also exposes `razor_key_secret, webgst, place_of_supply, smtp_email, smtp_password` in `SettingModel.Data.fromJson` (setting_model.dart:60-74) but the client never reads those.
- Razorpay payment options at `lib/view/application/member_application.dart:111` and `lib/view/application/application_track_details.dart:214` both set `'key': settingController.razorKeyId` — i.e., the live response value. **No fallback constant. If `/settings` 404s or returns a different shape, payment will silently break.**
- `logo/email/phone/websiteName/webaddress` appear stored but I found no reads of them in screens (Settings_Controller is a singleton injected once; setting screen UI in `lib/view/home_main/Setting.dart` calls `member_info` not these fields). Treat them as best-effort decorative — Razorpay key is the only load-bearing field.

### 3. Track / Know / MemberInfo — three separate features, different controllers.

- `track_application` — used by **one screen only**: `lib/view/application/application_track.dart:132` (Track Application by email + application_no). Followup screen `application_track_details.dart` then calls `get_member_activity` and `final_step`/`create_order` on retry.
- `know_membership` — used by **one screen only**: `lib/view/application/know_application_track.dart:154` ("Find Membership Number" by email + mobile). Returns list of matching applications; on `status==true` navigates to `knowYourApplication` route which then calls `member_info` for full details.
- `member_info` — **shared lookup-by-id endpoint**, called from many screens after they have an `id`:
  - `lib/view/application/member_application.dart:695, 784, 945` (resume / refresh inside apply wizard)
  - `lib/view/application/member application_edit.dart:589` (edit existing application)
  - `lib/view/application/member_application_details.dart:51` (view details)
  - `lib/view/application/application_convertion.dart:143` (ACM-to-LM conversion intake)
  - `lib/view/application/know_application.dart:218` (Know-flow details page)
  - `lib/view/home_main/Setting.dart:41` (member's own profile in nav settings)

These are three distinct UX surfaces; do not collapse into one route on the shim side. `member_info` is the high-traffic one.

### 4. Push notifications — Firebase FCM, plain token, no APNs/OneSignal.

- Call site: `lib/main.dart:678` inside `getDeviceId()` of `_MyAppState.initState()`.
- Payload: `{device_id: <FCM token>}` (just the FCM token, key name is misleading — it's a token, not a device id). No `device_token` key, no platform field. Token obtained from `FirebaseMessaging.instance.getToken()` (main.dart:675).
- Endpoint is `device_token_update`. Called once at app startup, fire-and-forget — `SettingsController.getDeviceId` (Settings_Controller.dart:69) does not retry or persist a "registered" flag.
- The FCM project ID is `amasi-8a5cc` (main.dart:644). The backend must be able to send FCM messages to whatever it stores in this column, against this Firebase project.

## Endpoint usage table

Field-types: all values are strings or numbers serialized through `FormData.fromMap()`. Any list/JSON-encoded payload is called out explicitly.

| Endpoint | Caller file:line | Fields sent | Response fields consumed | UI surface | Dead? |
|---|---|---|---|---|---|
| GET /settings | `lib/Controller/Settings_Controller.dart:23` | (none) | `status`, `data[0].{razor_key_id}`; `logo, website_name, email, phone, webaddress` are stored but unread | App boot (singleton init); Razorpay key sourcing | no |
| POST /device_token_update | `lib/main.dart:678` (via `Settings_Controller.dart:69`) | `device_id` (FCM token string) | none (response ignored) | App boot | no |
| POST /check_user_data | `lib/view/events/events_webview.dart:235` | `username` (= stored email) | `status`, `member`, `event` (cached to Hive for the event webview) | Event webview WillPop hook | no |
| POST /check_common_login | `lib/view/login_ext/login.dart:118` (via `Login_controller.dart:33 login()`) | `username`, `password`, `device_id` | `status`, `message`, `member`, `data[0].{id, application_id, membership_no, first_name, email, profile, application_status}`, `event`, `event_data[0].{id, first_name, email}`, `access_token` | Login screen "Login Password" tab (default tab) | no |
| POST /common_member_send_otp | `lib/view/login_ext/login.dart:68` (via `Login_controller.dart:193 getOtpSend`) | `email` | `status`, `message`, `userid` (parsed as `MemberSendOtpModel`) | Login screen "Login with OTP" tab → Send OTP button | no |
| POST /common_member_resend_otp | `lib/view/login_ext/login.dart:86` (via `Login_controller.dart:315 getResendOtp`) | `id` (= memberId from prior send), `email` | `message` | Login screen OTP step → Resend OTP link | no |
| POST /common_member_otp_verify | `lib/view/login_ext/login.dart:104` (via `Login_controller.dart:237 getOtpVerify`) | `email`, `id` (memberId), `otp`, `device_id` | `status`, `message`, `member`, `data[0].{id, application_id, membership_no, first_name, email, profile, application_status}`, `event`, `event_data[0].{id, first_name, email}`, `access_token` | Login screen OTP step → Verify button | no |
| POST /memberforgotpassword | `lib/view/login_ext/login.dart:128` (via `Login_controller.dart:142 getForgotPassword`) | `email` | `message` | Login screen Forgot Password form | no — but if password auth is dropped, this dies with it |
| POST /mobile_notification_list | `lib/view/ext_pages/notification.dart:29`, `lib/view/common_widgets/bottom_navigation_bar.dart:44` (badge count) | `member_id` | `data[]` items: each `{id, title, body, notify_image, url, read_status, ...}`. Title/body/image/url/read_status used. | Notification list screen + bottom-nav unread badge | no |
| POST /mobile_notification_all_read | `lib/view/ext_pages/notification.dart:39` | `member_id` | response written to obs but never read by UI | Mark-all-as-read button on notification list | no |
| POST /mobile_notification_status_update | `lib/view/ext_pages/notification.dart:48` | `id` (notification row id) | response written to obs but never read by UI | Tap single notification to toggle read state | no |
| POST /enquiry_form | `lib/view/application/know_application.dart:120` (via `know_application_controller.dart:23 getEnquiry`) | `first_name, last_name, email_id, mobile_number, member_no, subject, message` | `status, message` | Contact-us / enquiry dialog from "Know your AMASI Membership" screen | no |
| POST /know_membership | `lib/view/application/know_application_track.dart:154` (via `know_application_controller.dart:86 getTrackApplication`) | `email`, `mobile` (at least one required client-side) | `status`, `message`, `data[0].id` (only id is captured; rest of data passed to next screen) | "Find Membership Number" search screen | no |
| POST /send_details_toMail | `lib/view/application/know_application.dart:641` (via `know_application_controller.dart:148 getKnowApplicationResend`) | `id` (member application id) | `status, message` | "Send Details to My Email" button on Know-application details | no |
| POST /member_info | 7 sites listed in Critical decision #3 (via `application_list_controller.dart:697`, `track_application_controller.dart:127`, `know_application_controller.dart:193`) | `id` (member application id) | `MemberInfo` (`lib/Models/application_models/member_info_model.dart`) — heavily consumed: `data[0].{first_name, middle_name, last_name, father_name, salutation, dob, age, nationality, profile, mci_certificate, pg_degree_certificate, asi_member_certificate, active_license, letter_hod, mbbs_degree_certificate, other_inter_organisation, ...}`, `clinic[]`, `work_exp[]` | Wizard resume, Edit, View details, Conversion intake, Know flow, Profile settings | no |
| POST /track_application | `lib/view/application/application_track.dart:132` (via `track_application_controller.dart:16`) | `email`, `application_no` | `status, message, data[0].{id, application_id, membership_no, application_status, status_name}`, `payment_status[]` | Track Application screen → details page | no |
| POST /get_member_activity | `lib/view/application/application_track_details.dart:235` (via `track_application_controller.dart:81 getActivity`) | `member_id` | `data[]` (activity log rows, displayed as timeline) | Track Application details screen activity timeline | no |
| GET /get_country | `lib/view/application/member_application.dart:965`, `lib/view/application/member application_edit.dart:735` (via `application_list_controller.dart:174 getCountryList`) | (none) | `data[].{id, country_name, country_code}` (parsed as `CountryModel`) | Country dropdown in apply + edit wizard | no |
| POST /get_state | 5 call sites in `member_application.dart` and `member application_edit.dart` + `application_convertion.dart:144` (via `application_list_controller.dart:212 getStateList` and `:248 getClinicStateList`) | `id` (country id; e.g. `101` for India default) | `data[].{id, state_name}` (`StateModel`) | State dropdown per country (perm + clinic addresses + ASI/NMC state pickers) | no |
| GET /get_application | `lib/view/application/application_list.dart:24` (via `application_list_controller.dart:286 getApplicationList`) | (none) | `data[].{id, name, ...}` (`ApplicationListModel`) — list of membership types/tiers shown on landing | Application list landing screen | no |
| POST /send_otp | `lib/view/application/member_application.dart:711` and `:6923` (via `application_list_controller.dart:326 getSendOtp`) | `first_name, last_name, email, mobile_code, mobile, membership_no` | `status, message, userid` (`SendOtpModel`) — `userid` is the new draft application id | Apply wizard step 1 (after check_application_status, when no existing app) and the "Create Fresh" dialog branch | no |
| POST /otp_verify | `lib/view/application/member_application.dart:6793` (via `application_list_controller.dart:371 getVerifyOtp`) | `id` (= sendOtpData.userid), `otp` | `status, message, userid` (`VerifyOtpModel`) | OTP modal inside apply wizard step 1 | no |
| POST /resend_otp | `lib/view/application/member_application.dart:6769` (via `application_list_controller.dart:415 getResendOtp`) | `id` (sendOtpData.userid) | `status, message` (`ResendOtp`) | "Resend OTP" button inside apply OTP modal | no |
| POST /check_application_status | `lib/view/application/member_application.dart:659` (via `application_list_controller.dart:453`) | `first_name, last_name, email, mobile_code, mobile`, conditionally `membership_no` (only for app types 5,6) | `status, application_status` (string `"YES"`/`"NO"`), `userid`, `err_type` (1 = redirect to login), `message` | Apply wizard step 1 — Next button | no |
| POST /delete_clinic | `lib/view/application/member_application.dart:302`, `lib/view/application/member application_edit.dart:198` (via `application_list_controller.dart:501`) | `id` (clinic row id from `member_info.clinic[].id`) | response captured but value never read | "Remove address" button in clinic addresses card | no |
| POST /delete_work_exp | `lib/view/application/member_application.dart:381`, `lib/view/application/member application_edit.dart:280` (via `application_list_controller.dart:549`) | `id` (work_exp row id from `member_info.work_exp[].id`) | response captured but value never read | "Remove experience" button in experience card | no |
| POST /delete_old_member_application | `lib/view/application/member_application.dart:6921` (via `application_list_controller.dart:595`) | `id` (existing app userid) | response captured but value never read | "Create Fresh" path in CustomDialogBox (after detecting old app) | no |
| POST multipart /member_two | `lib/Controller/application_controller/application_list_controller.dart:846` (`personalDetailsSubmit()`) | **File field:** `profile` (jpg/png). **Form fields:** `id, application_id, father_name, salutation, middle_name, last_name, dob, age, nationality, zone, gender, street_line1, street_line2, country, state, city, pin, landline, stdcode, mailing_address`, then `clinic_name[i], clinic_address_one[i], clinic_address_two[i], clinic_country[i], clinic_state[i], clinic_city[i], clinic_pin_code[i], clinic_stdcode[i], clinic_landline[i], clinic_mailing_address[i]`, optional `clinic_id[i]` for existing rows. **Sets `Authorization: <accessToken>` header (no Bearer prefix).** | `status, message` | Apply wizard step 2 submit | no |
| POST multipart /member_three | `application_list_controller.dart:955` (`getEducationDetails()`) | **File fields:** `mci_certificate, pg_degree_certificate, asi_member_certificate, active_license, letter_hod, mbbs_degree_certificate`. **Form fields:** `id, application_id, edu_undergrad_degree (always ""), edu_undergrad_college, edu_undergrad_university, edu_undergrad_year, edu_postgrad_degree, edu_postgrad_college, edu_postgrad_university, edu_postgrad_year, edu_superspecialty_degree, edu_superspecialty_college, edu_superspecialty_university, edu_superspecialty_year, mci_council_number, mci_council_state, imr_reg_no, asi_membership_no, asi_state, other_inter_organisation` (CSV string e.g. `"SAGES,ELSA"`), `other_inter_organisation_value`, then `work_procedure[i], exp_in_year[i], no_of_procedures1[i], no_of_procedures2[i]`, optional `work_exp_id[i]`. **Sets `Authorization: <accessToken>` header.** | `status, message` | Apply wizard step 3 submit | no |
| POST /create_order | `lib/view/application/member_application.dart:800`, `lib/view/application/application_track_details.dart:298` (via `application_list_controller.dart:1081`) | `member_id` | `CreateOrderModel`: `id` (= Razorpay order_id), `amount`, `currency` | Apply wizard final step + retry-payment on tracked app | no |
| POST /final_step | `member_application.dart:52, :81`, `application_track_details.dart:170, :191` (via `application_list_controller.dart:1119 getPaymentDetailsSend`) | `id` (member app id), `amount`, `currency`, `payment_status` (`"Success"`/`"Failed"`), `payment_id`, `payment_json` (nested object from `response.data` or `response.error` — JSON-encoded by FormData layer), `application_id` | `PaymentDetailsSendModel.applicationNo` (used to navigate to success screen) | Razorpay success/failure callbacks | no |
| POST /application_data | `lib/view/application/application_submitted_successfully.dart:31` (via `application_list_controller.dart:1160`) | `application_no` | `ApplicationDataModel.application_data[]` (rendered as receipt-style summary on success screen) | Post-payment success screen | no |
| POST multipart /member_conversion | `application_list_controller.dart:1209` (`getApplicationConversion()`) | **File fields:** `mci_certificate, pg_degree_certificate, asi_member_certificate`. **Form fields:** `id, application_id, membership_no, asi_membership_no, asi_state`. **No Authorization header set on this multipart.** | `status, message` | ACM-to-LM conversion submit (`application_convertion.dart`) | no |

### Event endpoints

| Endpoint | Caller file:line | Fields sent | Response fields consumed | UI surface | Dead? |
|---|---|---|---|---|---|
| GET /get_event | `lib/view/events/event_calander.dart:62`, `lib/view/events/events.dart` not present — actually `lib/view/home_main/home_main.dart:85`, `lib/view/home_main/events.dart:78` (via `event_list_controller.dart:21 getEventList`) | (none) | `data[]` event rows (`EventListModel`) — title/date/banner | Home dashboard events tile, Events tab, Calendar | no |
| POST /get_register_event_ByUser | `lib/view/events/event_registration_list.dart:44` (via `event_list_controller.dart:59`) | `email` (from Hive) | `data[]` registration rows (`EventRegistrationModel`) | "Registered Events" list screen | no |
| POST /get_register_ticket_ByUser | `lib/view/events/event_registration_details.dart:250` (via `event_list_controller.dart:94`) | `email`, `event_id`, `attendee_id` ("" if not set) | `EventRegistrationDetailsModel` — ticket info, payments[0].paymentId, razorpay_order_id, razorpay_receiptId, tax_options, tax_type, attendees, etc. | Ticket details screen | no |

### Certificate / download URLs

These are direct `launchUrl()` calls in browser, not API JSON. The Flutter side doesn't parse them — they need to render PDFs/images directly.

- `${certificateBaseUrl}user-member-application-certificate-mobile/{id}` — referenced in app shells where members have certs.
- `${certificateBaseUrl}user-member-application-fmas-certificate-mobile/{id}` — FMAS cert.
- `${certificateBaseUrl}user-member-application-receipt/{id}` — payment receipt.
- `${certificateBaseUrl}user-member-application-invoice/{id}` — invoice (also used in `application_track_details.dart:288`).
- `${eventBaseUrl}events/user-event-invoice?eventId={eventId}&&email={email}` — event invoice.
- `${eventBaseUrl}downloadCertificate/{eventId}/{registrationId}` — event certificate.
- `${eventBaseUrl}downloadBadgePDF/{eventId}/{registrationId}` — badge PDF.

`certificateBaseUrl` is hard-coded to `https://application.amasi.org/application/` (`main.dart:31`) — the old backend. **These will not migrate via the base-URL switch alone — see Single biggest blocker.**

## File upload field shapes

Multipart endpoints. Field names must match exactly on the shim — the Flutter client cannot easily be patched in field-by-field.

### /member_two (`personalDetailsSubmit`, `application_list_controller.dart:846`)
- File field: `profile` (single image file, jpg/png; client caps 2 MB, see `_pickFiles` at `member_application.dart:838`).
- Indexed form fields: `clinic_name[i]`, `clinic_address_one[i]`, `clinic_address_two[i]`, `clinic_country[i]`, `clinic_state[i]`, `clinic_city[i]`, `clinic_pin_code[i]`, `clinic_stdcode[i]`, `clinic_landline[i]`, `clinic_mailing_address[i]` (and optional `clinic_id[i]` when editing an existing clinic).

### /member_three (`getEducationDetails`, `application_list_controller.dart:955`)
- File fields (each is a single file, jpg/png/pdf, 2 MB cap): `mci_certificate`, `pg_degree_certificate`, `asi_member_certificate`, `active_license`, `letter_hod`, `mbbs_degree_certificate`.
- Indexed form fields: `work_procedure[i]`, `exp_in_year[i]`, `no_of_procedures1[i]`, `no_of_procedures2[i]`, optional `work_exp_id[i]`.
- CSV-encoded scalar: `other_inter_organisation` is a comma-joined string of `["SAGES","ELSA","Others"]` subset (e.g. literally `"SAGES,ELSA"`), NOT a JSON array. Free-text `other_inter_organisation_value` accompanies.

### /member_conversion (`getApplicationConversion`, `application_list_controller.dart:1209`)
- File fields: `mci_certificate`, `pg_degree_certificate`, `asi_member_certificate`.
- Form fields: `id`, `application_id`, `membership_no`, `asi_membership_no`, `asi_state`.

## Auth header / JWT handling

The app DOES store an `access_token` from `/check_common_login` and `/common_member_otp_verify` responses (saved to Hive `itemsDB` box under key `accessToken`, `Login_controller.dart:82` and `:264`).

It IS sent only on the two authenticated multipart submits:
- `/member_two` — `request.headers['Authorization'] = hiveMethod.accessToken.toString()` (`application_list_controller.dart:848`).
- `/member_three` — same line at `application_list_controller.dart:957`.

**Note: no `Bearer ` prefix.** The raw token string is the entire header value. If the shim's JWT middleware expects `Bearer <token>`, it will reject these two endpoints.

**Every other endpoint sends NO Authorization header** (`api/api_service.dart:47-52` only sets `Content-Type` and `X-Source: mobile-app`). The shim does not need to validate any token for the other 31 main endpoints + 3 event endpoints; it must accept the bare-token Authorization on member_two/member_three or treat it as advisory.

`/member_conversion` does NOT set Authorization (`application_list_controller.dart:1209` block, no header line). Inconsistency between submit and conversion is in the BlazingCoders code — likely a bug they never noticed.

There is no token refresh path. `refresh_token` is parsed into `LoginModel` (`Models/login_model.dart:7,33`) but never read or sent back anywhere. Sessions are effectively permanent until the user logs out (Hive box wiped).

## Single biggest blocker for ship

**The four downloadable PDF URLs are hardcoded to the old backend.** `lib/main.dart:31` sets `certificateBaseUrl = "https://application.amasi.org/application/"` and the four mobile cert/receipt/invoice paths are concatenated at use sites (e.g. `application_track_details.dart:288`). The base URL switch at `main.dart:27` only redirects `/api/` traffic to the new backend — the cert URLs continue hitting the dead BlazingCoders host. Even with a perfect API shim, every "Download Receipt / Invoice / Certificate / FMAS Certificate" button on the mobile app will 404 on day one. This requires a Flutter code change (replace `certificateBaseUrl` with a `membership.amasi.org`-based path) and a Play Store / TestFlight release before the migration is "like-for-like." Everything else is shim-able; this is the one hard blocker.

Secondary risks (shimmable but worth knowing):
1. **Authorization header has no `Bearer ` prefix** on `/member_two` and `/member_three` — shim must accept raw-token Authorization or reject these endpoints.
2. **No JWT validation on 31 of 33 main endpoints** — the legacy app trusts `id` / `member_id` in the body. The shim has to either replicate that trust model or accept that a mobile patch is required to start sending Authorization everywhere.
3. **Firebase project `amasi-8a5cc`** — the new backend must publish FCM via this exact project (server key under user's control), otherwise notifications break silently.
4. The login screen lives on a **gradient background** with `setPhase`-style toggles between OTP and password — both code paths are live in production. Cannot drop password login without a Flutter UI change.
