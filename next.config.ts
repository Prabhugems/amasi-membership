import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
]

// Exported (not inlined in `headers()` below) so __tests__/next-config-headers.test.ts
// can assert on it directly, without going through the Sentry/bundle-analyzer
// wrapping this file's default export gets. Every route gets `securityHeaders`
// via the catch-all; a later, more specific `source` overrides one key for a
// narrower path — see "Header Overriding Behavior" in Next's headers() docs
// (last matching rule for a given key wins). This is how the X-Frame-Options
// exception below works, and how any future same-origin-framing need should
// be added: don't touch `securityHeaders`, append another scoped rule after it.
export async function headerRules() {
  // CORS headers for /api/* are owned by src/middleware.ts (dynamic
  // origin reflection against an allowlist). Static `headers()` can only
  // return one Access-Control-Allow-Origin value, which broke every
  // *.amasi.org subdomain trying to call our public APIs from the browser.
  return [
    {
      source: "/(.*)",
      headers: securityHeaders,
    },
    {
      // The admin lightbox (src/app/pending/page.tsx) frames this route in
      // an <iframe> to preview PDFs. X-Frame-Options: DENY above blocks ALL
      // framing, same-origin included, so the preview always failed with
      // "membership.amasi.org refused to connect." Listed after the
      // catch-all so it wins (last matching header for a given key wins —
      // see Next.js headers() "Header Overriding Behavior"). SAMEORIGIN
      // still blocks any other site from framing a document, which is all
      // the clickjacking protection this route needs.
      source: "/api/applications/:id/document/:key",
      headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
    },
  ]
}

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
    optimizePackageImports: ["lucide-react", "recharts", "framer-motion"],
  },
  headers: headerRules,
};

export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "amasi",

  project: "amasi-membership",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
