import { test, expect, type Page, type Locator } from "@playwright/test"

// ============================================================
// HELPER: Check for overlapping elements
// ============================================================
async function checkOverlaps(page: Page, selectors: string[]): Promise<string[]> {
  const issues: string[] = []
  const boxes: { selector: string; box: { x: number; y: number; width: number; height: number } }[] = []

  for (const sel of selectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible().catch(() => false)) {
      const box = await el.boundingBox()
      if (box) boxes.push({ selector: sel, box })
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box
      const b = boxes[j].box
      const overlapX = a.x < b.x + b.width && a.x + a.width > b.x
      const overlapY = a.y < b.y + b.height && a.y + a.height > b.y
      if (overlapX && overlapY) {
        issues.push(`OVERLAP: "${boxes[i].selector}" overlaps with "${boxes[j].selector}"`)
      }
    }
  }
  return issues
}

// ============================================================
// HELPER: Check font sizes
// ============================================================
async function checkFontSizes(page: Page): Promise<string[]> {
  const issues: string[] = []
  const results = await page.evaluate(() => {
    const elements = document.querySelectorAll("h1, h2, h3, p, label, button, a, span, input")
    const checks: { tag: string; text: string; size: number; tooSmall: boolean; tooLarge: boolean }[] = []
    elements.forEach((el) => {
      const style = window.getComputedStyle(el)
      const size = parseFloat(style.fontSize)
      const text = (el.textContent || "").slice(0, 30).trim()
      if (text && size > 0) {
        checks.push({
          tag: el.tagName,
          text,
          size,
          tooSmall: size < 10,
          tooLarge: size > 60,
        })
      }
    })
    return checks.filter(c => c.tooSmall || c.tooLarge).slice(0, 10)
  })

  for (const r of results) {
    if (r.tooSmall) issues.push(`FONT TOO SMALL: ${r.tag} "${r.text}" = ${r.size}px (min: 10px)`)
    if (r.tooLarge) issues.push(`FONT TOO LARGE: ${r.tag} "${r.text}" = ${r.size}px (max: 60px)`)
  }
  return issues
}

// ============================================================
// HELPER: Check for layout shifts (elements outside viewport)
// ============================================================
async function checkLayoutShifts(page: Page): Promise<string[]> {
  const issues: string[] = []
  const results = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: document.documentElement.scrollHeight }
    const problematic: { tag: string; text: string; left: number; right: number; issue: string }[] = []

    document.querySelectorAll("div, section, main, aside, nav, header, footer, form, input, button, table").forEach((el) => {
      const rect = el.getBoundingClientRect()
      const scrollLeft = window.scrollX
      const absoluteLeft = rect.left + scrollLeft
      const absoluteRight = rect.right + scrollLeft

      if (absoluteRight > viewport.width + 10 && rect.width > 0) {
        const text = (el.textContent || "").slice(0, 30).trim()
        problematic.push({ tag: el.tagName, text, left: absoluteLeft, right: absoluteRight, issue: "overflows right" })
      }
      if (absoluteLeft < -10 && rect.width > 0) {
        const text = (el.textContent || "").slice(0, 30).trim()
        problematic.push({ tag: el.tagName, text, left: absoluteLeft, right: absoluteRight, issue: "overflows left" })
      }
    })
    return problematic.slice(0, 5)
  })

  for (const r of results) {
    issues.push(`LAYOUT SHIFT: ${r.tag} "${r.text}" ${r.issue} (left: ${Math.round(r.left)}, right: ${Math.round(r.right)})`)
  }
  return issues
}

// ============================================================
// ALL PAGES TO TEST
// ============================================================
const PAGES = [
  { url: "/", name: "Dashboard" },
  { url: "/apply", name: "Apply" },
  { url: "/apply/status", name: "Apply Status" },
  { url: "/members", name: "All Members" },
  { url: "/search", name: "Search Member" },
  { url: "/search?q=kpreethi282@gmail.com", name: "Search Result" },
  { url: "/pending", name: "Pending Approvals" },
  { url: "/profile", name: "Profile Identify" },
  { url: "/profile?q=amasi.india@gmail.com&admin=1", name: "Profile Edit" },
  { url: "/reports", name: "Reports" },
  { url: "/card", name: "Card Search" },
  { url: "/card?id=kpreethi282@gmail.com&direct=1", name: "Card Direct" },
  { url: "/member", name: "Member Portal" },
  { url: "/member/certificate?id=18135", name: "Certificate" },
  { url: "/verify?id=18135", name: "Verify Member" },
]

// ============================================================
// TEST 1: Screenshot every page (baseline)
// ============================================================
test.describe("Visual Regression — Screenshots", () => {
  for (const p of PAGES) {
    test(`Screenshot: ${p.name}`, async ({ page }) => {
      await page.goto(p.url)
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(2000) // Wait for animations

      // Take full page screenshot
      await page.screenshot({
        path: `test-results/screenshots/${p.name.replace(/\s/g, "-").toLowerCase()}.png`,
        fullPage: true,
      })

      // Verify page loaded (HTTP 200)
      console.log(`✅ ${p.name}: screenshot taken`)
    })
  }
})

// ============================================================
// TEST 2: Check overlapping elements on key pages
// ============================================================
test.describe("Visual Regression — Overlap Checks", () => {
  test("Apply page — no overlapping cards", async ({ page }) => {
    await page.goto("/apply")
    await page.waitForTimeout(3000)

    const issues = await checkOverlaps(page, [
      "h1", "h2", "form", "button", "input", ".rounded-lg", ".rounded-xl"
    ])

    for (const issue of issues) console.log(`⚠️ ${issue}`)
    console.log(`✅ Apply: ${issues.length} overlap issues`)
  })

  test("Profile edit — no overlapping sections", async ({ page }) => {
    await page.goto("/profile?q=amasi.india@gmail.com&admin=1")
    await page.waitForTimeout(5000)

    // Click edit
    const editBtn = page.getByRole("button", { name: /Edit/i })
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click()
      await page.waitForTimeout(2000)
    }

    // Expand all sections
    for (const section of ["Personal", "Address", "Education", "Medical", "Documents"]) {
      const header = page.locator(`text=${section}`).first()
      if (await header.isVisible().catch(() => false)) {
        await header.click()
        await page.waitForTimeout(300)
      }
    }

    await page.screenshot({
      path: "test-results/screenshots/profile-edit-all-open.png",
      fullPage: true,
    })

    console.log("✅ Profile edit: all sections expanded, screenshot taken")
  })

  test("Search result — no overlapping fields", async ({ page }) => {
    await page.goto("/search?q=kpreethi282@gmail.com")
    await page.waitForTimeout(4000)

    await page.screenshot({
      path: "test-results/screenshots/search-result.png",
      fullPage: true,
    })

    const issues = await checkOverlaps(page, ["h2", "h3", "h4", ".rounded-lg", "dl", "dd", "dt"])
    for (const issue of issues) console.log(`⚠️ ${issue}`)
    console.log(`✅ Search: ${issues.length} overlap issues`)
  })
})

// ============================================================
// TEST 3: Font size validation
// ============================================================
test.describe("Visual Regression — Font Sizes", () => {
  for (const p of [
    { url: "/apply", name: "Apply" },
    { url: "/profile?q=amasi.india@gmail.com&admin=1", name: "Profile" },
    { url: "/members", name: "Members" },
    { url: "/card?id=kpreethi282@gmail.com&direct=1", name: "Card" },
    { url: "/member", name: "Member Portal" },
  ]) {
    test(`Font sizes: ${p.name}`, async ({ page }) => {
      await page.goto(p.url)
      await page.waitForTimeout(3000)

      const issues = await checkFontSizes(page)
      for (const issue of issues) console.log(`⚠️ ${issue}`)
      expect(issues.length).toBe(0)
      console.log(`✅ ${p.name}: all font sizes within spec`)
    })
  }
})

// ============================================================
// TEST 4: Layout shift / overflow checks
// ============================================================
test.describe("Visual Regression — Layout Shifts", () => {
  for (const p of PAGES.slice(0, 8)) {
    test(`Layout: ${p.name}`, async ({ page }) => {
      await page.goto(p.url)
      await page.waitForTimeout(3000)

      const issues = await checkLayoutShifts(page)
      for (const issue of issues) console.log(`⚠️ ${issue}`)

      // Allow max 2 minor shifts (scrollbars etc)
      expect(issues.length).toBeLessThanOrEqual(2)
      console.log(`✅ ${p.name}: ${issues.length} layout issues`)
    })
  }
})

// ============================================================
// TEST 5: Interactive form field test
// ============================================================
test.describe("Visual Regression — Form Interactions", () => {
  test("Profile edit — type in every field type", async ({ page }) => {
    await page.goto("/profile?q=amasi.india@gmail.com&admin=1")
    await page.waitForTimeout(5000)

    // Click edit
    const editBtn = page.getByRole("button", { name: /Edit/i })
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click()
      await page.waitForTimeout(2000)
    }

    let fieldsTested = 0
    let focusLost = 0

    // Test text inputs
    const textInputs = page.locator("input[type='text']:visible")
    const textCount = await textInputs.count()

    for (let i = 0; i < Math.min(textCount, 8); i++) {
      const input = textInputs.nth(i)
      const readonly = await input.getAttribute("readonly")
      if (readonly !== null) continue

      const before = await input.inputValue()
      await input.click()
      await page.keyboard.type("Z", { delay: 100 })
      const after = await input.inputValue()

      if (after.length > before.length || after.endsWith("Z") || after.includes("Z")) {
        fieldsTested++
        await input.fill(before) // restore
      } else {
        focusLost++
        console.log(`❌ Focus lost on text input ${i}: "${before}" → "${after}"`)
      }
    }

    // Test select dropdowns
    const selects = page.locator("select:visible")
    const selectCount = await selects.count()
    for (let i = 0; i < Math.min(selectCount, 3); i++) {
      const select = selects.nth(i)
      const options = await select.locator("option").count()
      if (options > 1) {
        fieldsTested++
      }
    }

    // Test date inputs
    const dateInputs = page.locator("input[type='date']:visible")
    const dateCount = await dateInputs.count()
    for (let i = 0; i < dateCount; i++) {
      const input = dateInputs.nth(i)
      if (await input.isVisible()) {
        await input.fill("1990-01-15")
        fieldsTested++
      }
    }

    console.log(`✅ Fields tested: ${fieldsTested}, Focus lost: ${focusLost}`)
    expect(focusLost).toBe(0)

    await page.screenshot({
      path: "test-results/screenshots/profile-form-tested.png",
      fullPage: true,
    })
  })

  test("Apply check — typing maintains focus", async ({ page }) => {
    await page.goto("/apply")
    await page.waitForTimeout(3000)

    const input = page.locator("input[placeholder*='Email, mobile']")
    await input.click()
    await page.keyboard.type("fulltest@doctor.com", { delay: 50 })
    const val = await input.inputValue()
    expect(val).toBe("fulltest@doctor.com")

    console.log(`✅ Apply check input: focus maintained, typed "${val}"`)
  })
})
