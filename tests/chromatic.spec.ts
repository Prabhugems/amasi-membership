import { test, expect } from "@chromatic-com/playwright"

// All pages to capture for Chromatic visual review
const PAGES = [
  { url: "/", name: "Dashboard" },
  { url: "/apply", name: "Apply - Check" },
  { url: "/apply/status", name: "Apply - Track Status" },
  { url: "/members", name: "All Members" },
  { url: "/search", name: "Search Member" },
  { url: "/search?q=kpreethi282@gmail.com", name: "Search - Result Found" },
  { url: "/pending", name: "Admin - Pending Approvals" },
  { url: "/profile", name: "Profile - Identify" },
  { url: "/profile?q=amasi.india@gmail.com&admin=1", name: "Profile - Edit View" },
  { url: "/reports", name: "Reports" },
  { url: "/card", name: "Card - Search" },
  { url: "/card?id=kpreethi282@gmail.com&direct=1", name: "Card - Direct View" },
  { url: "/member", name: "Member Portal - Login" },
  { url: "/member/certificate?id=18135", name: "Certificate Download" },
  { url: "/verify?id=18135", name: "Verify Member - Public" },
]

test.describe("AMASI — All Pages", () => {
  for (const p of PAGES) {
    test(p.name, async ({ page }) => {
      await page.goto(p.url)
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(2000)

      // Chromatic auto-captures screenshot
      await expect(page).toHaveScreenshot()
    })
  }
})

test.describe("AMASI — Profile Edit Sections", () => {
  test("Personal Information - Open", async ({ page }) => {
    await page.goto("/profile?q=amasi.india@gmail.com&admin=1")
    await page.waitForTimeout(5000)

    const editBtn = page.getByRole("button", { name: /Edit/i })
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click()
      await page.waitForTimeout(1000)
    }

    // Open Personal section
    const header = page.locator("text=Personal Information").first()
    if (await header.isVisible().catch(() => false)) {
      await header.click()
      await page.waitForTimeout(500)
    }

    await expect(page).toHaveScreenshot()
  })

  test("Address - Open with PIN", async ({ page }) => {
    await page.goto("/profile?q=amasi.india@gmail.com&admin=1")
    await page.waitForTimeout(5000)

    const editBtn = page.getByRole("button", { name: /Edit/i })
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click()
      await page.waitForTimeout(1000)
    }

    const header = page.locator("text=Address").first()
    if (await header.isVisible().catch(() => false)) {
      await header.click()
      await page.waitForTimeout(500)
    }

    await expect(page).toHaveScreenshot()
  })

  test("Education - Open", async ({ page }) => {
    await page.goto("/profile?q=amasi.india@gmail.com&admin=1")
    await page.waitForTimeout(5000)

    const editBtn = page.getByRole("button", { name: /Edit/i })
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click()
      await page.waitForTimeout(1000)
    }

    const header = page.locator("text=Education").first()
    if (await header.isVisible().catch(() => false)) {
      await header.click()
      await page.waitForTimeout(500)
    }

    await expect(page).toHaveScreenshot()
  })

  test("Medical Registration - Open", async ({ page }) => {
    await page.goto("/profile?q=amasi.india@gmail.com&admin=1")
    await page.waitForTimeout(5000)

    const editBtn = page.getByRole("button", { name: /Edit/i })
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click()
      await page.waitForTimeout(1000)
    }

    const header = page.locator("text=Medical Registration").first()
    if (await header.isVisible().catch(() => false)) {
      await header.click()
      await page.waitForTimeout(500)
    }

    await expect(page).toHaveScreenshot()
  })

  test("Documents - Open", async ({ page }) => {
    await page.goto("/profile?q=amasi.india@gmail.com&admin=1")
    await page.waitForTimeout(5000)

    const editBtn = page.getByRole("button", { name: /Edit/i })
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click()
      await page.waitForTimeout(1000)
    }

    const header = page.locator("text=Documents").first()
    if (await header.isVisible().catch(() => false)) {
      await header.click()
      await page.waitForTimeout(500)
    }

    await expect(page).toHaveScreenshot()
  })
})
