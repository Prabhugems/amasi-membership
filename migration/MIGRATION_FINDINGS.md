# MIGRATION_FINDINGS.md

Read-only investigation of the BlazingCoders Flutter app handover (`~/AMASI-Mobile-blazingcoders/`, currently `v1.0.4+2 / versionCode 30`, applicationId/bundle `com.amasi.amasi`). All claims cite file:line in that repo unless otherwise noted.

---

## 1. Architecture reality check

**The Flutter app talks to a backend HTTP server.** It does NOT hold a Postgres/Supabase client — no `supabase_flutter`, no PostgREST, no `realtime-dart` in `pubspec.yaml:30-83`. Network stack is `dio: ^5.3.0` + `http: ^1.1.2` only, wrapped by:

- `lib/api/api_service.dart:7-53` — `ApiService` singleton wrapping Dio. Every call is POST (or GET) of `FormData.fromMap(...)` with `Content-Type: multipart/form-data` and a custom `X-Source: mobile-app` header.
- `lib/api_client/api_client.dart:31-38` — `BaseOptions.baseUrl = baseUrl`, connect/receive/send timeouts all 6s.
- `lib/api/event_api_service.dart` + `lib/api_client/event_api_client.dart` — second Dio instance for the event subsystem.

**Active base URLs (`lib/main.dart:27-31`):**

```
baseUrl            = "https://membership.amasi.org/api/"        // line 27 — our new portal
eventBaseUrl       = "https://eventz360.amasi.org/"             // line 28 — legacy event subsystem
certificateBaseUrl = "https://application.amasi.org/application/" // line 31 — legacy, will die
```

Three commented-out base-URL variants survive in `main.dart:25, 26, 29, 30` (legacy prod, vercel preview, dev). These are dead code (commented).

### Every distinct host referenced in the Flutter source

Grep `https://` across `lib/`. Excluding commented dead code and `lib/test.dart` (a 31KB scratch file, fully commented — see §6 for status):

| Host | Purpose | Status if `application.amasi.org` dies |
|---|---|---|
| `https://membership.amasi.org/api/` | Main API base (`main.dart:27`) | **OK** — our new portal |
| `https://eventz360.amasi.org/` | Event API base (`main.dart:28`) | OK if eventz360 stays up; out of scope for this migration |
| `https://application.amasi.org/application/` | PDF cert/receipt/invoice base (`main.dart:31`) | **BROKEN** — see §5 |
| `https://www.amasi.org/news-letters` | WordPress newsletter (`home_main/home_main.dart:352`) | OK |
| `https://www.amasi.org/privacy-policy` | TOS (`home_main/Setting.dart:143`) | OK |
| `https://www.amasi.org/terms-and-conditions-refund-policy` | T&C (`home_main/Setting.dart:134`) | OK |
| `https://amasi.org/*` (28 distinct page slugs) | WordPress content links in side nav (`common_widgets/bottom_navigation_bar.dart:171, 462-710`) | OK |
| `https://www.collegeofmas.org/` | External link (`home_main/home_main.dart:321`) | OK |
| `https://amasi.org/annals-of-minimal-access-surgery/` | External link (`home_main/home_main.dart:336`) | OK |
| `https://amasicon2026.com/` | Conference site (`home_main/home_main.dart:366`, `common_widgets/bottom_navigation_bar.dart:691`) | OK |
| `https://drive.google.com/file/d/1hjHsdAPY08o5DTXbpfQcDi7W8-2RJ_qk/view` | Announcement PDF (`view/home_main/announcement.dart:23`) | OK |
| `https://amasi.org/wp-content/uploads/2025/06/*` (7 file links) | MOU forms (`view/ext_pages/MOU_applications.dart:24-72`) | OK |
| `https://forms.fillout.com/t/{7YQezLqwWZus, mx7oPyJuCAus}` | External MOU intake (`view/ext_pages/MOU_applications.dart:80, 88`) | OK |
| `https://play.google.com/store/apps/details?id=$packageName` | Self-update CTA (`main.dart:747`) | OK |
| `https://maps.google.com/?q=...` | Contact-us map (`view/contact_us.dart:81`) | OK |
| `'https://www.amasi.org'` literal fallback | Used as a placeholder URL (`view/application/application_submitted_successfully.dart:506` — comment says "Replace with actual URL") | OK but dead-default |

**Conclusion for §1:** The app expects a backend server exposing Express-style routes. Anything we ship (Next.js shim layer OR a separately hosted Express proxy in front of our `mobile_v` views) must respond on `https://membership.amasi.org/api/<path>` with multipart-form bodies and the response envelopes that the Flutter client expects (see §2).

---

## 2. Endpoint inventory

All endpoints below are POST against `baseUrl` and send `multipart/form-data` unless marked GET. Field types are stringified through `FormData.fromMap()` — the wire format has no real numbers or booleans; the server must coerce.

### Main API (called from `lib/`)

| # | Method | Path | Caller file:line | Fields sent | Screen / flow |
|---|---|---|---|---|---|
| 1 | GET | `/settings` | `Controller/Settings_Controller.dart:23` | (none) | App boot — singleton init; supplies `razor_key_id` |
| 2 | POST | `/device_token_update` | `main.dart:678` via `Settings_Controller.dart:69` | `device_id` (FCM token) | App boot |
| 3 | POST | `/check_user_data` | `view/events/events_webview.dart:235` | `username` (= stored email) | Event webview WillPop hook |
| 4 | POST | `/check_common_login` | `view/login_ext/login.dart:118` via `Controller/Login_controller.dart:33` | `username, password, device_id` | Login screen — "Login Password" tab (default tab, `login.dart:18`) |
| 5 | POST | `/common_member_send_otp` | `view/login_ext/login.dart:68` via `Login_controller.dart:193` | `email` | Login screen — "Login with OTP" tab → Send OTP |
| 6 | POST | `/common_member_resend_otp` | `view/login_ext/login.dart:86` via `Login_controller.dart:315` | `id` (= memberId), `email` | OTP step → Resend |
| 7 | POST | `/common_member_otp_verify` | `view/login_ext/login.dart:104` via `Login_controller.dart:237` | `email, id, otp, device_id` | OTP step → Verify |
| 8 | POST | `/memberforgotpassword` | `view/login_ext/login.dart:128` via `Login_controller.dart:142` | `email` | Forgot Password form |
| 9 | POST | `/mobile_notification_list` | `view/ext_pages/notification.dart:29`, `view/common_widgets/bottom_navigation_bar.dart:44` | `member_id` | Notification list + bottom-nav unread badge |
| 10 | POST | `/mobile_notification_all_read` | `view/ext_pages/notification.dart:39` | `member_id` | "Mark all read" |
| 11 | POST | `/mobile_notification_status_update` | `view/ext_pages/notification.dart:48` | `id` | Tap to toggle one |
| 12 | POST | `/enquiry_form` | `view/application/know_application.dart:120` via `Controller/application_controller/know_application_controller.dart:23` | `first_name, last_name, email_id, mobile_number, member_no, subject, message` | Enquiry dialog from "Know your Membership" |
| 13 | POST | `/know_membership` | `view/application/know_application_track.dart:154` via `know_application_controller.dart:86` | `email, mobile` | "Find Membership Number" search |
| 14 | POST | `/send_details_toMail` | `view/application/know_application.dart:641` via `know_application_controller.dart:148` | `id` | "Email me my details" button |
| 15 | POST | `/member_info` | 7 call sites (see Note A below) | `id` | Wizard resume, Edit, View details, Conversion intake, Know flow, Profile settings |
| 16 | POST | `/track_application` | `view/application/application_track.dart:132` via `Controller/application_controller/track_application_controller.dart:16` | `email, application_no` | Track Application |
| 17 | POST | `/get_member_activity` | `view/application/application_track_details.dart:235` via `track_application_controller.dart:81` | `member_id` | Activity timeline on Track Details |
| 18 | GET | `/get_country` | `view/application/member_application.dart:965`, `view/application/member application_edit.dart:735` via `Controller/application_controller/application_list_controller.dart:174` | (none) | Country dropdown |
| 19 | POST | `/get_state` | 5 call sites in `member_application.dart` + `member application_edit.dart` + `application_convertion.dart:144` via `application_list_controller.dart:212, :248` | `id` (country id) | State dropdown |
| 20 | GET | `/get_application` | `view/application/application_list.dart:24` via `application_list_controller.dart:286` | (none) | Membership type list (landing) |
| 21 | POST | `/send_otp` | `view/application/member_application.dart:711`, `:6923` via `application_list_controller.dart:326` | `first_name, last_name, email, mobile_code, mobile, membership_no` | Apply wizard step 1; "Create Fresh" branch |
| 22 | POST | `/otp_verify` | `view/application/member_application.dart:6793` via `application_list_controller.dart:371` | `id, otp` | Apply OTP modal — Verify |
| 23 | POST | `/resend_otp` | `view/application/member_application.dart:6769` via `application_list_controller.dart:415` | `id` | Apply OTP modal — Resend |
| 24 | POST | `/check_application_status` | `view/application/member_application.dart:659` via `application_list_controller.dart:453` | `first_name, last_name, email, mobile_code, mobile`, `membership_no` (only for app types 5,6) | Apply wizard step 1 — Next |
| 25 | POST | `/delete_clinic` | `view/application/member_application.dart:302`, `view/application/member application_edit.dart:198` via `application_list_controller.dart:501` | `id` (clinic row id) | "Remove address" |
| 26 | POST | `/delete_work_exp` | `view/application/member_application.dart:381`, `view/application/member application_edit.dart:280` via `application_list_controller.dart:549` | `id` (work_exp row id) | "Remove experience" |
| 27 | POST | `/delete_old_member_application` | `view/application/member_application.dart:6921` via `application_list_controller.dart:595` | `id` (existing app userid) | "Create Fresh" path (see §4) |
| 28 | POST mp | `/member_two` | `Controller/application_controller/application_list_controller.dart:846` (`personalDetailsSubmit`) | File `profile`; fields `id, application_id, father_name, salutation, middle_name, last_name, dob, age, nationality, zone, gender, street_line1, street_line2, country, state, city, pin, landline, stdcode, mailing_address`, indexed `clinic_name[i], clinic_address_one[i], clinic_address_two[i], clinic_country[i], clinic_state[i], clinic_city[i], clinic_pin_code[i], clinic_stdcode[i], clinic_landline[i], clinic_mailing_address[i]`, optional `clinic_id[i]`. **Sets `Authorization: <accessToken>` header (no `Bearer ` prefix).** | Apply wizard step 2 submit |
| 29 | POST mp | `/member_three` | `application_list_controller.dart:955` (`getEducationDetails`) | Files `mci_certificate, pg_degree_certificate, asi_member_certificate, active_license, letter_hod, mbbs_degree_certificate`; fields `id, application_id, edu_undergrad_degree (always ""), edu_undergrad_college, edu_undergrad_university, edu_undergrad_year, edu_postgrad_degree, edu_postgrad_college, edu_postgrad_university, edu_postgrad_year, edu_superspecialty_degree, edu_superspecialty_college, edu_superspecialty_university, edu_superspecialty_year, mci_council_number, mci_council_state, imr_reg_no, asi_membership_no, asi_state, other_inter_organisation` (CSV string e.g. `"SAGES,ELSA"`), `other_inter_organisation_value`, indexed `work_procedure[i], exp_in_year[i], no_of_procedures1[i], no_of_procedures2[i]`, optional `work_exp_id[i]`. **Sets `Authorization: <accessToken>` (no Bearer).** | Apply wizard step 3 submit |
| 30 | POST | `/create_order` | `view/application/member_application.dart:800`, `view/application/application_track_details.dart:298` via `application_list_controller.dart:1081` | `member_id` | Apply final step + retry payment |
| 31 | POST | `/final_step` | `view/application/member_application.dart:52, :81`, `view/application/application_track_details.dart:170, :191` via `application_list_controller.dart:1119` | `id, amount, currency, payment_status ("Success" or "Failed"), payment_id, payment_json, application_id` — **see §3** | Razorpay success/failure callbacks |
| 32 | POST | `/application_data` | `view/application/application_submitted_successfully.dart:31` via `application_list_controller.dart:1160` | `application_no` | Post-payment success screen |
| 33 | POST mp | `/member_conversion` | `application_list_controller.dart:1209` (`getApplicationConversion`) | Files `mci_certificate, pg_degree_certificate, asi_member_certificate`; fields `id, application_id, membership_no, asi_membership_no, asi_state`. **No Authorization header set** (legacy bug — inconsistent with member_two/three). | ACM-to-LM conversion submit |

**Note A — `/member_info` call sites:** `view/application/member_application.dart:695, 784, 945`; `view/application/member application_edit.dart:589`; `view/application/member_application_details.dart:51`; `view/application/application_convertion.dart:143`; `view/application/know_application.dart:218`; `view/home_main/Setting.dart:41`. Same payload (`{id}`), same response model (`MemberInfo` in `Models/application_models/member_info_model.dart`).

### Event API (separate base, `eventBaseUrl`)

| Method | Path | Caller file:line | Fields sent | Screen |
|---|---|---|---|---|
| GET | `/get_event` | `view/home_main/home_main.dart:85`, `view/home_main/events.dart:78` via `Controller/event_controller/event_list_controller.dart:21` | (none) | Home events tile + Events tab |
| POST | `/get_register_event_ByUser` | `view/events/event_registration_list.dart:44` via `event_list_controller.dart:59` | `email` | Registered Events list |
| POST | `/get_register_ticket_ByUser` | `view/events/event_registration_details.dart:250` via `event_list_controller.dart:94` | `email, event_id, attendee_id` | Ticket details |

### Auth header summary

- `accessToken` stored in Hive `itemsDB` box under key `accessToken` from `/check_common_login` (`Login_controller.dart:82`) and `/common_member_otp_verify` (`Login_controller.dart:264`) responses.
- Sent ONLY on `/member_two` (`application_list_controller.dart:848`) and `/member_three` (`application_list_controller.dart:957`) as raw `Authorization: <token>` — no `Bearer ` prefix.
- 31 of 33 main endpoints + all 3 event endpoints send no `Authorization` header.
- `refresh_token` field is parsed into `Models/login_model.dart:7,33` but never read or sent back anywhere. No refresh flow exists.

---

## 3. Razorpay signature — decision-gating finding

**The Flutter `_handlePaymentSuccess` callback does NOT forward `razorpay_signature` or `razorpay_order_id` as named fields to `/final_step`.**

Exact payload (4 call sites — all identical shape):

**`view/application/member_application.dart:51-60`:**

```dart
void _handlePaymentSuccess(PaymentSuccessResponse response) async {
  bool success = await applicationController.getPaymentDetailsSend("final_step", {
    "id": applicationController.userId,
    "amount": applicationController.createOrderData.value.amount,
    "currency": applicationController.createOrderData.value.currency,
    "payment_status": "Success",
    "payment_id": response.paymentId,
    "payment_json": response.data,
    "application_id": applicationController.arguments,
  });
```

The same shape repeats at `member_application.dart:81-88` (failure), `application_track_details.dart:170-178` (retry-success), `application_track_details.dart:191-198` (retry-failure).

**What's missing:** `razorpay_flutter`'s `PaymentSuccessResponse` exposes `paymentId`, `orderId`, `signature` as **named** public fields. The Flutter app reads only `response.paymentId` (line 57) and `response.data` (line 58). It never reads `response.signature` or `response.orderId` into top-level form fields.

**What's in `payment_json`:** `PaymentSuccessResponse.data` is `Map<String, dynamic>?` — the raw Razorpay event map. Per Razorpay's Flutter SDK, this map contains `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` as keys when Razorpay returns them. So the signature IS technically inside `payment_json` — but on the wire, `FormData.fromMap({"payment_json": <Map>, ...})` does NOT JSON-encode nested maps. Dio's FormData serializes `Map` values by calling `.toString()` on them, producing a Dart Map literal like `{razorpay_payment_id: pay_..., razorpay_order_id: order_..., razorpay_signature: ...}` — not parseable as JSON server-side without custom string parsing.

**Implication:** the existing v1.0.4+2 binary cannot satisfy HMAC signature verification on the server without either (a) the server doing fragile string parsing of the Dart-Map-literal `payment_json` body, or (b) a Flutter code change that adds explicit `razorpay_order_id` and `razorpay_signature` named form fields.

---

## 4. `delete_old_member_application` — is it called?

**Yes — wired to a visible UI button. CSRF/data-loss surface, no auth, takes id from client.**

Single call site: `view/application/member_application.dart:6921`, inside the `onPressed` of the **"CREATE FRESH"** `OutlinedButton` in the `CustomDialogBox` shown when the user has an incomplete prior application:

```dart
// member_application.dart:6919-6933
OutlinedButton(
  onPressed: () async {
    applicationController.getOldApplicationDelete("delete_old_member_application", {
      "id": applicationController.userId,
    }).then((value) => applicationController.getSendOtp("send_otp", {
      "first_name": applicationController.firstNameController.text,
      "last_name": applicationController.lastNameController.text,
      "email": applicationController.emailController.text,
      "mobile_code": applicationController.mobileCodeController.text,
      "mobile": applicationController.mobileController.text,
      "membership_no": applicationController.memberShipNumberCodeController.text,
    }));
    Navigator.of(context).pop();
    onCreateFresh(context, true);
  },
```

**Trigger condition:** Apply wizard step 1 — user taps Next, `/check_application_status` returns `application_status: "YES"` (existing app found) with `err_type: 1`, the dialog at `member_application.dart:~6890` shows "You have another incomplete application … Do you want to continue with the old application or create a new one?" — tapping **CREATE FRESH** fires the delete.

**Payload:** `{id: applicationController.userId}` — `userId` is whatever `check_application_status` returned in `userid`. Zero auth header on this call (`application_list_controller.dart:595`). The legacy backend handler (per `backend-spec.md`) executes a hard `DELETE FROM tbl_member WHERE id = ?` with no ownership check. Replicating verbatim ships a data-loss vector accessible to any client that knows the endpoint name.

---

## 5. Hardcoded hosts that break on legacy shutdown

### `certificateBaseUrl` — confirmed

`lib/main.dart:31`:

```dart
String certificateBaseUrl = "https://application.amasi.org/application/";
```

### The 4 distinct PDF paths and their call sites

| # | Path template | Call sites |
|---|---|---|
| 1 | `${certificateBaseUrl}user-member-application-certificate-mobile/{id}` | `view/home_main/Setting.dart:78` (member's own cert from profile menu); `view/application/application_track_details.dart:425` (Track → Download Certificate) |
| 2 | `${certificateBaseUrl}user-member-application-fmas-certificate-mobile/{id}` | `view/home_main/Setting.dart:94` (member's own FMAS cert from profile menu) |
| 3 | `${certificateBaseUrl}user-member-application-receipt/{id}` | `view/application/application_submitted_successfully.dart:385` (post-payment success — Download Receipt); `view/application/application_track_details.dart:525` (Track → Download Receipt) |
| 4 | `${certificateBaseUrl}user-member-application-invoice/{id}` | `view/application/application_track_details.dart:288` (Track → Download Invoice) |

All 6 call sites use `Uri.parse('${certificateBaseUrl}…')` and `launchUrl()` — they 404 against the dead host with no in-app fallback, no Sentry capture, no toast.

### Any OTHER hardcoded host beyond the `/api` base that would 404 on legacy shutdown?

Searched `lib/` for `application.amasi.org` and `dev-application.amasi.org`:

- `main.dart:25` — `// String baseUrl = "https://application.amasi.org/api/";` — **commented, dead.**
- `main.dart:29` — `// String baseUrl = "https://dev-application.amasi.org/api/";` — **commented, dead.**
- `main.dart:31` — `certificateBaseUrl` — the live one above.
- `lib/test.dart:24, 26, 480, 482` — all commented inside the fully-commented scratch file (see §6 Note B).

**No other live references to `application.amasi.org` exist in the source.** When the legacy host dies, the breakage is bounded to the 4 PDF paths above. (Event subsystem at `eventz360.amasi.org` is on a separate host — not in this migration's blast radius.)

---

## 6. Build & release readiness

### Bundle / version

- Android `applicationId`: `com.amasi.amasi` (`android/app/build.gradle:55`)
- iOS bundle ID: `com.amasi.amasi` (`ios/Runner.xcodeproj/project.pbxproj`, `PRODUCT_BUNDLE_IDENTIFIER`)
- `versionCode`: `30` (`android/app/build.gradle:58`)
- `versionName`: `"1.0.4+2"` (`android/app/build.gradle:59`); matches `pubspec.yaml:19` `version: 1.0.4+2`
- Namespace: `com.amasi.amasi` (`android/app/build.gradle:38`); compileSdk 35, targetSdk 35, ndk `29.0.14033849`, buildTools `36.0.0`

### Android signing config — **mis-pathed as shipped; build will not produce a signed release as-is**

`android/app/build.gradle:31-34` loads keystore properties via:

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) { … }
```

`rootProject` is the `android/` directory, so this expects `android/key.properties`. But the actual `key.properties` file ships at the **Flutter repo root** (`~/AMASI-Mobile-blazingcoders/key.properties`), not at `android/key.properties`. The signing config will load null values silently.

Even if `key.properties` is found, its `storeFile` is `./upload-keystore.jks` (relative). The keystore file ships at the **repo root** (`~/AMASI-Mobile-blazingcoders/upload-keystore.jks`) — not under `android/app/` where Gradle resolves a `./` relative path. Confirmed via `ls`: only the repo-root copy exists.

`key.properties` contents (cleartext, checked into git):

```
storePassword=amasiamasi
keyPassword=amasiamasi
keyAlias=upload
storeFile=./upload-keystore.jks
```

**Status:** we have the keystore bytes (`upload-keystore.jks` at repo root) and the cleartext passwords. We are NOT blocked on the dev for keys — but the path/build wiring needs a small fix before a signed release is producible. **Trust level on the key is effectively zero** — passwords are cleartext, checked into git, "amasiamasi" both — anyone with read access to the repo can sign Play Store updates masquerading as `com.amasi.amasi`. Plan to rotate via Play App Signing upload-key replacement before the next release.

### iOS signing

`ios/Runner.xcodeproj/project.pbxproj` declares `PRODUCT_BUNDLE_IDENTIFIER = com.amasi.amasi` but **no provisioning profile or signing certificate is in the repo** (and none should be — Apple signing is account-bound, can't be checked in). To produce an iOS release we need the AMASI Apple Developer team's signing identity + provisioning profile, which the BlazingCoders handover does not include.

### `.env` / runtime config

- No `.env`, `.env.example`, `.env.production`, or similar file at the Flutter repo root.
- `pubspec.yaml:56` declares `flutter_dotenv: ^5.2.1` — but `grep` across `lib/` for `dotenv` / `DotEnv` / `.load(` produces **zero hits**. The dependency is declared but unused.
- `.gitignore` does NOT mention `.env`. There was never a `.env` to be ignored.
- Conclusion: no runtime config file is needed. All endpoints/keys/Firebase project come from compiled-in constants (`main.dart`) and the Firebase config files below.

### Firebase config files (checked into repo, expected by FCM)

- `android/app/google-services.json` (667 bytes) — present, references Firebase project `amasi-8a5cc`.
- `ios/Runner/GoogleService-Info.plist` (869 bytes) — present, same project.

These are public per Google's documentation (they ship in the app binary regardless), so committing them is acceptable. To receive FCM from our new backend, the server must hold a Firebase Admin service-account key for project `amasi-8a5cc` — **this is the same key that leaked in the handover; rotate per the credential-leak memo before using.**

### Note B — `lib/test.dart`

31 KB Dart file at `lib/test.dart`. **First 10 lines confirm it is fully commented out** — every line begins with `//`. Treat it as dead scratch code; ignore all references it contains. Recommend deletion once we own the repo for real.

---

## BLOCKERS / NEED FROM DEV

Items we could NOT answer from the source alone, or that require something from outside the repo before next step:

1. **Razorpay signature wire format.** We need a live capture of the actual HTTP request body of `/final_step` from a real payment (proxy the in-stores app via Charles/mitmproxy, or pull from legacy Express request logs). The static answer in §3 says the signature is inside `payment_json` as a Dart-Map-literal string, but we should verify the on-the-wire bytes before designing how the shim parses it — Dio may behave differently than the docs suggest with nested-Map FormData values.
2. **iOS signing identity.** Handover did not include an Apple Developer team membership, signing certificate, or `.mobileprovision`. We need either (a) admission to the existing AMASI Apple Developer team, or (b) a new team registered under our control + transfer of the bundle ID `com.amasi.amasi`. Without this we cannot ship an iOS update — only an Android one.
3. **Confirmation that the Flutter team will accept a Flutter code change.** Two changes are needed before the migration is "like-for-like":
   - Replace `certificateBaseUrl` (`main.dart:31`) with a `membership.amasi.org`-based path AND wire the 4 PDF paths in §5 to the new portal's equivalent endpoints (which don't exist yet either — needs a backend ask).
   - Decide whether to keep the password tab as the default (`login.dart:18`) or hide it. The new portal is OTP-only; if password stays default, we either ship the password-but-do-OTP UX wart or shim something. This is a product/UX call, not investigable from code alone.
4. **`mobile_v` schema mapping confidence.** The brief mentions 13 read-only views matching `tbl_*` shapes plus a scoped `mobile_team` Postgres role. We did not inspect that schema in this pass (out of scope per "read-only investigation, no code"). Before §2 endpoints get implemented against `mobile_v`, we need a separate sanity check that every column the spec references (e.g. `tbl_member.application_status` 12-state enum, `tbl_member.Razorpay_orderID`'s irregular capitalization, `tbl_settings.razor_key_id`, etc.) is exposed through `mobile_v` with matching column names and types.
5. **`/check_user_data` semantics.** The endpoint is called from inside the event webview (`events_webview.dart:235`) right before the WillPop hook navigates away. The legacy contract treats the response `member` and `event` flags as cache-write keys into Hive. Whether this endpoint needs to be implemented on day one or can be stubbed to `{status: true}` depends on whether the event webview is part of the mobile-only release scope.
6. **Firebase Admin key rotation status.** Before the shim sends FCM via project `amasi-8a5cc`, the leaked admin key from the handover must be revoked and a fresh one issued. Need confirmation from whoever has Firebase Console access for `amasi-8a5cc`.
7. **Current Razorpay key in `/settings`.** The Flutter app passes `razor_key_id` from `/settings` directly into `Razorpay().open(options)`. We need to know which Razorpay account/key the legacy server returns today and whether the migration uses the same key, a new one, or the one in our amasi-membership server-side config. (Razorpay's `key_id` is meant to be public — this is not a secret-rotation question, it's a "which account does payment land in" question.)

---

## Shim deployed (2026-05-27)

P0-15 routes shipped as Next.js route handlers under `src/app/api/<legacy_name>/`. Production build passes (44s compile), 28/28 envelope-contract tests green (`__tests__/mobile-shim-contracts.test.ts`).

| Concern | How the shim resolves it |
|---|---|
| Middleware allowlist (CONTEXT.md "Fragile areas") | All 33 paths added to `PUBLIC_API_ROUTES` in `src/middleware.ts`. |
| Observability gap (Sentry returned 0 for `mobile-app` 401s) | Middleware capture now reads `X-Source: mobile-app`, fingerprints as `mobile-app-middleware-reject:<path>`, tags `x_source:mobile-app` + `reason:mobile_app_not_allowlisted`. |
| Razorpay signature gap (BLOCKER #1 above) | `/final_step` does server-side `razorpay.orders.fetch` + `razorpay.payments.fetch`, validates `order_id` / `amount` / `currency` / `status === "captured"`. Client `payment_status` IGNORED. Catches the legacy fraud surface; the "I paid for someone else's order, replay payment_id" attack still requires HMAC and remains as a follow-up Flutter release. |
| Settings secret leak | `/api/settings` returns `data[0]: { razor_key_id }` only — no `razor_key_secret`, no SMTP creds. |
| Document gate on multipart uploads | `/member_three` writes uploads with `bypass: true, bypassReason: "user_bypass"` so the existing approval flow routes them to manual review rather than auto-approving. |
| Submission gap | `/final_step` records payment + marks draft `has_verified_payment=true` but does NOT auto-submit to `membership_applications`. Paid drafts visible in admin via `draft_applications.has_verified_payment=true AND status='in_progress'`. Follow-up. |
| Domain | `application.amasi.org` added to the `amasi-membership` Vercel project. DNS pending. See `migration/SHIM_README.md` "Custom domain". |
