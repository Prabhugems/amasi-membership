// One-off icon generator for the PWA install assets.
// Run: node scripts/gen-pwa-icons.mjs
import sharp from "sharp"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const src = path.join(root, "public", "amasi-logo.png")
const outDir = path.join(root, "public", "icons")

await mkdir(outDir, { recursive: true })

const BRAND_BG = { r: 255, g: 255, b: 255, alpha: 1 } // white
const MASKABLE_BG = { r: 15, g: 118, b: 110, alpha: 1 } // teal #0f766e

async function squareWithBg(size, bg, padRatio) {
  const inner = Math.round(size * padRatio)
  const offset = Math.round((size - inner) / 2)
  const logo = await sharp(src).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  return sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: logo, top: offset, left: offset }])
    .png()
}

// Standard "any" icons — minimal padding (logo fills most of the square)
await (await squareWithBg(192, BRAND_BG, 0.92)).toFile(path.join(outDir, "icon-192.png"))
await (await squareWithBg(512, BRAND_BG, 0.92)).toFile(path.join(outDir, "icon-512.png"))

// Maskable — safe zone is the inner 80% of the canvas (Android may crop edges)
await (await squareWithBg(512, MASKABLE_BG, 0.6)).toFile(path.join(outDir, "icon-maskable-512.png"))

// Apple touch icon (180x180)
await (await squareWithBg(180, BRAND_BG, 0.88)).toFile(path.join(outDir, "apple-touch-icon.png"))

console.log("Wrote PWA icons to", outDir)
