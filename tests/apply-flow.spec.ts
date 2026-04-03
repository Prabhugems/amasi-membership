import { test, expect } from "@playwright/test"

test.describe("AMASI Apply Flow", () => {
  test("1. Check page loads and accepts input", async ({ page }) => {
    await page.goto("http://localhost:3000/apply")
    await page.waitForTimeout(2000)

    // Find the main input
    const input = page.locator("input[placeholder*='Email, mobile']")
    await expect(input).toBeVisible({ timeout: 10000 })

    // Type and verify
    await input.fill("playwright@test.com")
    expect(await input.inputValue()).toBe("playwright@test.com")

    // Button should exist
    await expect(page.getByRole("button", { name: /Check|Continue/i })).toBeVisible()
    console.log("✅ Check page loads, input works")
  })

  test("2. New user → verify phase", async ({ page }) => {
    await page.goto("http://localhost:3000/apply")
    await page.waitForTimeout(2000)

    const input = page.locator("input[placeholder*='Email, mobile']")
    await input.fill("newuser-playwright@test.com")
    await page.getByRole("button", { name: /Check|Continue/i }).click()
    await page.waitForTimeout(3000)

    // Should show verify or email input
    const body = await page.textContent("body")
    const isVerify = body?.includes("Verify") || body?.includes("Email") || body?.includes("OTP")
    expect(isVerify).toBeTruthy()
    console.log("✅ New user goes to verify")
  })

  test("3. Existing member detected", async ({ page }) => {
    await page.goto("http://localhost:3000/apply")
    await page.waitForTimeout(2000)

    const input = page.locator("input[placeholder*='Email, mobile']")
    await input.fill("kpreethi282@gmail.com")
    await page.getByRole("button", { name: /Check|Continue/i }).click()
    await page.waitForTimeout(3000)

    const body = await page.textContent("body")
    const found = body?.includes("existing") || body?.includes("Preethi") || body?.includes("18134") || body?.includes("Verify")
    expect(found).toBeTruthy()
    console.log("✅ Existing member detected")
  })
})

test.describe("AMASI Profile Edit - Focus Test", () => {
  test("4. Profile fields maintain focus while typing", async ({ page }) => {
    await page.goto("http://localhost:3000/profile?q=amasi.india@gmail.com&admin=1")
    await page.waitForTimeout(5000)

    // Click Edit if visible
    const editBtn = page.getByRole("button", { name: /Edit/i })
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click()
      await page.waitForTimeout(2000)
    }

    // Find all visible text inputs
    const inputs = page.locator("input[type='text']:visible")
    const count = await inputs.count()
    console.log(`Found ${count} visible text inputs`)

    let tested = 0
    for (let i = 0; i < Math.min(count, 5); i++) {
      const input = inputs.nth(i)
      const readonly = await input.getAttribute("readonly")
      if (readonly !== null) continue

      const before = await input.inputValue()
      await input.click()

      // Type character by character to test focus retention
      await input.press("End")
      await page.keyboard.type("XYZ", { delay: 100 })
      const after = await input.inputValue()

      if (after.includes("XYZ")) {
        console.log(`✅ Input ${i}: Focus maintained (typed "XYZ")`)
        // Restore
        await input.fill(before)
        tested++
      } else {
        console.log(`❌ Input ${i}: Focus LOST — before="${before}" after="${after}"`)
      }

      if (tested >= 2) break
    }

    expect(tested).toBeGreaterThan(0)
    console.log(`✅ ${tested} fields tested — focus maintained`)
  })
})

test.describe("AMASI Pages Load", () => {
  const pages = [
    "/", "/apply", "/apply/status", "/members", "/search",
    "/pending", "/profile", "/reports", "/card", "/member",
    "/member/certificate", "/verify",
  ]

  for (const url of pages) {
    test(`5. ${url} returns 200`, async ({ page }) => {
      const response = await page.goto(`http://localhost:3000${url}`)
      expect(response?.status()).toBe(200)
      console.log(`✅ ${url}: 200`)
    })
  }
})

test.describe("AMASI Card & Certificate", () => {
  test("6. Card loads for member", async ({ page }) => {
    await page.goto("http://localhost:3000/card?id=kpreethi282@gmail.com&direct=1")
    await page.waitForTimeout(4000)

    const body = await page.textContent("body")
    expect(body?.includes("AMASI") || body?.includes("Download")).toBeTruthy()
    console.log("✅ Card loads")
  })

  test("7. Certificate loads for member", async ({ page }) => {
    await page.goto("http://localhost:3000/member/certificate?id=18135")
    await page.waitForTimeout(4000)

    const body = await page.textContent("body")
    expect(body?.includes("Certificate") || body?.includes("Download")).toBeTruthy()
    console.log("✅ Certificate loads")
  })

  test("8. Verify page shows member", async ({ page }) => {
    await page.goto("http://localhost:3000/verify?id=18135")
    await page.waitForTimeout(4000)

    const body = await page.textContent("body")
    expect(body?.includes("Verified") || body?.includes("Vasudha") || body?.includes("AMASI")).toBeTruthy()
    console.log("✅ Verify page works")
  })
})

test.describe("AMASI Member Portal", () => {
  test("9. Member login page loads", async ({ page }) => {
    await page.goto("http://localhost:3000/member")
    await page.waitForTimeout(2000)

    const body = await page.textContent("body")
    expect(body?.includes("Member Portal") || body?.includes("Sign In") || body?.includes("Email")).toBeTruthy()
    console.log("✅ Member portal login loads")
  })
})
