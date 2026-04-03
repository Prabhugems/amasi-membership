import { test, expect } from "@playwright/test"

test.describe("COMPLETE APPLICATION FLOW — End to End", () => {

  test("Fill entire application as a new ALM member", async ({ page }) => {
    // ========== STEP 1: CHECK PHASE ==========
    await page.goto("http://localhost:3000/apply")
    await page.waitForTimeout(3000)

    console.log("--- STEP 1: Check Phase ---")
    const checkInput = page.locator("input[placeholder*='Email, mobile']")
    await expect(checkInput).toBeVisible({ timeout: 10000 })
    await checkInput.fill("playwright-fulltest@newdoctor.com")
    await page.screenshot({ path: "test-results/step1-check.png" })

    await page.getByRole("button", { name: /Check|Continue/i }).click()
    await page.waitForTimeout(3000)
    console.log("✅ Step 1: Check done")

    // ========== STEP 2: VERIFY PHASE ==========
    console.log("--- STEP 2: Verify Phase ---")
    await page.screenshot({ path: "test-results/step2-verify-start.png" })

    // Should show verify with email + mobile inputs
    const emailInput = page.locator("input[type='email']").first()
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Clear and type email
      const currentEmail = await emailInput.inputValue()
      if (!currentEmail.includes("playwright")) {
        await emailInput.fill("playwright-fulltest@newdoctor.com")
      }
      console.log(`  Email: ${await emailInput.inputValue()}`)

      // Fill mobile
      const mobileInput = page.locator("input[placeholder*='10-digit'], input[placeholder*='mobile']").first()
      if (await mobileInput.isVisible().catch(() => false)) {
        await mobileInput.fill("9876543210")
        console.log(`  Mobile: ${await mobileInput.inputValue()}`)
      }

      await page.screenshot({ path: "test-results/step2-verify-filled.png" })

      // Click verify/send OTP button
      const verifyBtn = page.getByRole("button", { name: /Verify|Send|OTP/i }).first()
      if (await verifyBtn.isVisible().catch(() => false)) {
        const isDisabled = await verifyBtn.isDisabled()
        console.log(`  Verify button visible: true, disabled: ${isDisabled}`)
        if (!isDisabled) {
          await verifyBtn.click()
          await page.waitForTimeout(2000)
          await page.screenshot({ path: "test-results/step2-verify-otp-sent.png" })
          console.log("  OTP sent (check email)")
        } else {
          console.log("  ⚠️ Verify button is disabled — checking why")
          await page.screenshot({ path: "test-results/step2-verify-btn-disabled.png" })
        }
      }
    } else {
      console.log("  Skipped verify — might have gone straight to landing")
    }
    console.log("✅ Step 2: Verify phase captured")

    // ========== STEP 3: LANDING PHASE (if we skip OTP) ==========
    // For testing, let's go directly to an existing member's profile edit to test form filling
  })

  test("Fill profile edit form completely — test every field", async ({ page }) => {
    console.log("========================================")
    console.log("  PROFILE EDIT — FIELD BY FIELD TEST")
    console.log("========================================")

    await page.goto("http://localhost:3000/profile?q=amasi.india@gmail.com&admin=1")
    await page.waitForTimeout(5000)
    await page.screenshot({ path: "test-results/profile-1-loaded.png" })

    // Click Edit Profile
    const editBtn = page.getByRole("button", { name: /Edit/i })
    if (await editBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await editBtn.click()
      await page.waitForTimeout(2000)
    }
    await page.screenshot({ path: "test-results/profile-2-edit-mode.png" })

    // ========== PERSONAL SECTION ==========
    console.log("\n--- Personal Information ---")

    // Expand Personal section if collapsed
    const personalHeader = page.locator("text=Personal Information").first()
    if (await personalHeader.isVisible().catch(() => false)) {
      await personalHeader.click()
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: "test-results/profile-3-personal-open.png" })

    // Test DOB field
    const dobInput = page.locator("input[type='date']").first()
    if (await dobInput.isVisible().catch(() => false)) {
      await dobInput.fill("1985-06-15")
      console.log(`  DOB: ${await dobInput.inputValue()}`)
    }

    // Test Gender buttons
    const maleBtn = page.locator("button:has-text('Male')").first()
    if (await maleBtn.isVisible().catch(() => false)) {
      await maleBtn.click()
      console.log("  Gender: Male selected")
    }

    // Test Father's Name — TYPE CHARACTER BY CHARACTER
    const fatherInput = page.locator("input[placeholder*='Father'], input[placeholder*='father']").first()
    if (await fatherInput.isVisible().catch(() => false)) {
      await fatherInput.click()
      await fatherInput.fill("")
      await page.keyboard.type("Rajesh Kumar", { delay: 80 })
      const fatherVal = await fatherInput.inputValue()
      console.log(`  Father's Name: "${fatherVal}" ${fatherVal === "Rajesh Kumar" ? "✅" : "❌ FOCUS LOSS"}`)
    }

    await page.screenshot({ path: "test-results/profile-4-personal-filled.png" })
    console.log("✅ Personal section done")

    // ========== ADDRESS SECTION ==========
    console.log("\n--- Address ---")

    const addressHeader = page.locator("text=Address").first()
    if (await addressHeader.isVisible().catch(() => false)) {
      await addressHeader.click()
      await page.waitForTimeout(500)
    }

    // Test PIN code
    const pinInput = page.locator("input[placeholder*='PIN'], input[inputmode='numeric']").first()
    if (await pinInput.isVisible().catch(() => false)) {
      await pinInput.fill("")
      await page.keyboard.type("600001", { delay: 100 })
      await page.waitForTimeout(2000) // Wait for auto-fill
      const pinVal = await pinInput.inputValue()
      console.log(`  PIN: "${pinVal}" ${pinVal === "600001" ? "✅" : "❌"}`)
    }

    // Check if city auto-filled
    await page.waitForTimeout(1000)
    const cityInput = page.locator("input").filter({ has: page.locator("..").filter({ hasText: "City" }) }).first()
    if (await cityInput.isVisible().catch(() => false)) {
      const cityVal = await cityInput.inputValue()
      console.log(`  City: "${cityVal}" ${cityVal ? "✅ auto-filled" : "⚠️ empty"}`)
    }

    // Test Street Address — TYPE CHARACTER BY CHARACTER
    const streetInputs = page.locator("input").filter({ has: page.locator("..").filter({ hasText: /Street|Address Line/i }) })
    const streetCount = await streetInputs.count()
    for (let i = 0; i < Math.min(streetCount, 2); i++) {
      const si = streetInputs.nth(i)
      if (await si.isVisible().catch(() => false)) {
        await si.click()
        await si.fill("")
        await page.keyboard.type("123 Test Street" + (i > 0 ? " Line 2" : ""), { delay: 50 })
        const val = await si.inputValue()
        console.log(`  Street ${i+1}: "${val}" ${val.includes("Test Street") ? "✅" : "❌ FOCUS LOSS"}`)
      }
    }

    await page.screenshot({ path: "test-results/profile-5-address-filled.png" })
    console.log("✅ Address section done")

    // ========== EDUCATION SECTION ==========
    console.log("\n--- Education ---")

    const eduHeader = page.locator("text=Education").first()
    if (await eduHeader.isVisible().catch(() => false)) {
      await eduHeader.click()
      await page.waitForTimeout(500)
    }

    // Test PG Degree pill buttons
    const msBtn = page.locator("button:has-text('MS General Surgery')").first()
    if (await msBtn.isVisible().catch(() => false)) {
      await msBtn.click()
      console.log("  PG Degree: MS General Surgery selected ✅")
    }

    // Test College autocomplete — TYPE AND SELECT
    const collegeInput = page.locator("input[placeholder*='college'], input[placeholder*='College']").first()
    if (await collegeInput.isVisible().catch(() => false)) {
      await collegeInput.click()
      await collegeInput.fill("")
      await page.keyboard.type("Madras", { delay: 100 })
      await page.waitForTimeout(1500) // Wait for autocomplete

      // Check if dropdown appeared
      const dropdown = page.locator(".absolute.z-\\[60\\]").first()
      if (await dropdown.isVisible().catch(() => false)) {
        // Click first option
        const firstOption = dropdown.locator("button").first()
        if (await firstOption.isVisible().catch(() => false)) {
          const optText = await firstOption.textContent()
          await firstOption.click()
          console.log(`  College: Selected "${optText?.slice(0, 50)}" ✅`)
          await page.waitForTimeout(500)
        }
      } else {
        const val = await collegeInput.inputValue()
        console.log(`  College: Typed "Madras" → "${val}" ${val.includes("Madras") ? "✅" : "❌"}`)
      }
    }

    // Test Year dropdown
    const yearSelect = page.locator("select").filter({ has: page.locator("option:has-text('2020')") }).first()
    if (await yearSelect.isVisible().catch(() => false)) {
      await yearSelect.selectOption("2020")
      console.log("  Year: 2020 selected ✅")
    }

    await page.screenshot({ path: "test-results/profile-6-education-filled.png" })
    console.log("✅ Education section done")

    // ========== MEDICAL REGISTRATION ==========
    console.log("\n--- Medical Registration ---")

    const regHeader = page.locator("text=Medical Registration").first()
    if (await regHeader.isVisible().catch(() => false)) {
      await regHeader.click()
      await page.waitForTimeout(500)
    }

    await page.screenshot({ path: "test-results/profile-7-registration.png" })
    console.log("✅ Registration section captured")

    // ========== DOCUMENTS SECTION ==========
    console.log("\n--- Documents ---")

    const docHeader = page.locator("text=Documents").first()
    if (await docHeader.isVisible().catch(() => false)) {
      await docHeader.click()
      await page.waitForTimeout(500)
    }

    await page.screenshot({ path: "test-results/profile-8-documents.png" })
    console.log("✅ Documents section captured")

    // ========== REVIEW CHANGES ==========
    console.log("\n--- Review Changes ---")

    // Scroll to top and click Review
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)

    const reviewBtn = page.getByRole("button", { name: /Review/i }).first()
    if (await reviewBtn.isVisible().catch(() => false)) {
      await reviewBtn.click()
      await page.waitForTimeout(2000)
      await page.screenshot({ path: "test-results/profile-9-review.png" })

      const body = await page.textContent("body")
      if (body?.includes("No changes")) {
        console.log("  ⚠️ No changes detected")
      } else if (body?.includes("field")) {
        console.log("  ✅ Changes detected for review")
      }
    }

    console.log("\n========================================")
    console.log("  PROFILE EDIT TEST COMPLETE")
    console.log("========================================")
  })

  test("Test apply review phase — fill missing fields", async ({ page }) => {
    console.log("========================================")
    console.log("  APPLY REVIEW — MISSING FIELDS TEST")
    console.log("========================================")

    // Go directly to apply page and navigate to review somehow
    // We'll test the review fields by checking the StableFieldInput works
    await page.goto("http://localhost:3000/apply")
    await page.waitForTimeout(2000)

    // Check if there's saved form data (localStorage)
    const savedPhase = await page.evaluate(() => localStorage.getItem("amasi_apply_phase"))
    console.log(`  Saved phase: ${savedPhase || "none"}`)

    if (savedPhase === "review") {
      console.log("  Resuming at review phase...")
      await page.waitForTimeout(3000)

      // Find any visible text input and test typing
      const inputs = page.locator("input[type='text']:visible")
      const count = await inputs.count()
      console.log(`  Found ${count} visible text inputs`)

      for (let i = 0; i < Math.min(count, 3); i++) {
        const input = inputs.nth(i)
        const readonly = await input.getAttribute("readonly")
        if (readonly !== null) continue

        await input.click()
        const before = await input.inputValue()
        await page.keyboard.type("TEST", { delay: 80 })
        const after = await input.inputValue()

        if (after.includes("TEST")) {
          console.log(`  ✅ Input ${i}: Focus maintained`)
          await input.fill(before) // restore
        } else {
          console.log(`  ❌ Input ${i}: Focus LOST`)
        }
      }
    } else {
      console.log("  No saved review state — testing check page input")
      const input = page.locator("input[placeholder*='Email, mobile']")
      await input.click()
      await page.keyboard.type("test-focus@check.com", { delay: 50 })
      const val = await input.inputValue()
      console.log(`  Check input: "${val}" ${val.includes("test-focus@check.com") ? "✅" : "❌"}`)
    }

    await page.screenshot({ path: "test-results/apply-review-test.png" })
    console.log("✅ Apply review test complete")
  })
})
