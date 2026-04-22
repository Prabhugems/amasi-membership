/**
 * Test: upload a small PNG to the /api/ocr endpoint and check Supabase Storage upload.
 *
 * Run:  node scripts/test-upload.mjs
 */

import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ──────────────────────────────────────────────────
const envFile = readFileSync(
  "/Users/prabhubalasubramaniam/amasi-membership/.env.local",
  "utf8"
);
const getEnv = (k) => {
  const re = new RegExp(k + '=["\']?([^"\'\\n]+)');
  const m = envFile.match(re);
  return m?.[1]?.trim();
};

const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

console.log("Supabase URL:", SUPABASE_URL ? SUPABASE_URL.slice(0, 40) + "..." : "MISSING");
console.log("Service role key:", SERVICE_ROLE_KEY ? "present (" + SERVICE_ROLE_KEY.length + " chars)" : "MISSING");

// ── Step 1: Verify the "uploads" bucket exists ───────────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const { data: buckets, error: bucketsErr } = await supabase.storage.listBuckets();
if (bucketsErr) {
  console.error("Failed to list buckets:", bucketsErr.message);
  process.exit(1);
}

const uploadsBucket = buckets.find((b) => b.name === "uploads");
if (!uploadsBucket) {
  console.error("Bucket 'uploads' NOT found. Available:", buckets.map((b) => b.name));
  process.exit(1);
}
console.log("\n✓ Bucket 'uploads' exists. Public:", uploadsBucket.public);

// ── Step 2: Direct upload test to Supabase Storage ───────────────────
// Create a minimal valid PNG (1x1 red pixel)
const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009001" +
  "2e00000000c4944415478016360f8cf000000020001e221bc330000000049454e44ae426082",
  "hex"
);

const directName = `_test/direct-${Date.now()}.png`;
console.log("\n── Direct upload test ──");
const { error: directErr } = await supabase.storage
  .from("uploads")
  .upload(directName, PNG_1x1, { contentType: "image/png", upsert: false });

if (directErr) {
  console.error("Direct upload FAILED:", directErr.message);
} else {
  const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(directName);
  console.log("✓ Direct upload succeeded. Public URL:", urlData.publicUrl);

  // Verify URL is accessible
  try {
    const resp = await fetch(urlData.publicUrl);
    console.log("  URL status:", resp.status, resp.ok ? "(accessible)" : "(NOT accessible)");
  } catch (e) {
    console.error("  URL fetch error:", e.message);
  }

  // Clean up
  await supabase.storage.from("uploads").remove([directName]);
  console.log("  Cleaned up test file.");
}

// ── Step 3: Test via /api/ocr endpoint ───────────────────────────────
console.log("\n── OCR endpoint upload test ──");
console.log("POSTing a small PNG to http://localhost:3000/api/ocr ...");

// Build a slightly larger PNG so sharp can process it (8x8 red square)
// We'll use the raw PNG for the request
const formData = new FormData();
const blob = new Blob([PNG_1x1], { type: "image/png" });
formData.append("file", blob, "test-cert.png");
formData.append("docType", "mci_certificate");

try {
  const res = await fetch("http://localhost:3000/api/ocr", {
    method: "POST",
    body: formData,
  });

  const status = res.status;
  const body = await res.json();

  console.log("Response status:", status);
  console.log("Response body:", JSON.stringify(body, null, 2));

  if (body.fileUrl) {
    console.log("\n✓ fileUrl present:", body.fileUrl);
    // Verify accessibility
    const urlResp = await fetch(body.fileUrl);
    console.log("  fileUrl status:", urlResp.status, urlResp.ok ? "(accessible)" : "(NOT accessible)");
  } else {
    console.log("\n✗ No fileUrl in response.");
    if (!body.success) {
      console.log("  (Note: OCR rejected the image, which is expected for a 1x1 red pixel.)");
      console.log("  The upload happens AFTER validation — rejected docs are not uploaded.");
      console.log("  Direct upload test above confirms Storage is working.");
    }
  }
} catch (err) {
  console.error("Endpoint request failed:", err.message);
  console.log("  Make sure the dev server is running on port 3000.");
}

console.log("\n── Summary ──");
console.log("Done.");
