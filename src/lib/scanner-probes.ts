/**
 * Heuristic classifier for vulnerability-scanner probe paths under /api/.
 *
 * Closes the AMASI-MEMBERSHIP-2V regression source remaining after the
 * /api/admin/* carve-out shipped in 92dbd2e: bots continuously scan every
 * public site for leaked .env files, WordPress login forms, phpmyadmin,
 * etc., and each new probe path with an unfamiliar shape triggers a fresh
 * Sentry "Middleware rejected /api/* request" event. The dominant probe
 * on 2026-05-30 was GET /api/.env from a Russian/CIS VPS.
 *
 * The original middleware capture was designed to detect missing-allowlist
 * regressions for *legitimate* endpoints. Probe paths cannot represent
 * that class of regression, because:
 *
 *   1. Dotfile segments (`.env`, `.git`, `.aws`, `.ssh`, `.htaccess`) — the
 *      Next.js app-router convention forbids dotfile route segments, so
 *      any such path under /api/ is definitionally not one of our routes.
 *   2. PHP / ASP / JSP / CGI / CFM extensions — this app is pure Next.js;
 *      no real route ends in `.php`, `.aspx`, `.jsp`, `.cgi`, `.cfm`.
 *   3. WordPress / phpmyadmin / xmlrpc / cgi-bin / server-status / adminer
 *      — well-known scanner wordlist markers for tech stacks we don't run.
 *
 * Detection is heuristic-only and intentionally conservative — false
 * negatives (a scanner pattern we haven't seen) are fine because they
 * just keep producing one-off Sentry warnings the way they do today.
 * False positives (a legitimate /api/* path mis-flagged as a probe) WOULD
 * be a real regression because they'd silence allowlist-miss alerts —
 * the test suite guards against that.
 *
 * Companion to the cookie-absent + /api/admin/* carve-outs in
 * src/middleware.ts (see the comment block above the captureMessage call
 * for the full rationale and incident history).
 */

/** True if the path looks like an automated vulnerability-scanner probe. */
export function isScannerProbe(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false

  // Dotfile probes: /api/.env, /api/.env.local, /api/.git/config,
  // /api/.aws/credentials, /api/.ssh/id_rsa, /api/.htaccess, etc.
  if (/^\/api\/\./.test(pathname)) return true

  // Server-language file extensions never used by this Next.js app.
  // The trailing alternation (slash, end-of-string, or query-string)
  // prevents matching a literal substring inside an otherwise-fine
  // segment (e.g. a hypothetical /api/cphp-something/ wouldn't match).
  if (/\.(php|aspx?|jsp|cgi|cfm|pl|sh)(\/|$|\?)/i.test(pathname)) return true

  // Known scanner-wordlist markers, anywhere in the path. Word-boundary
  // anchored on the trailing side so /api/wp-login matches but a
  // hypothetical /api/wp-something-legitimate would also match — that's
  // the conservative trade: a real WP-prefixed route doesn't exist here
  // and adding one would be a clearer signal than the Sentry capture.
  if (
    /\/(wp-(?:login|admin|content|includes|config)|phpmyadmin|xmlrpc|cgi-bin|server-status|adminer)\b/i.test(
      pathname,
    )
  ) {
    return true
  }

  return false
}
