# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: visual-regression.spec.ts >> Visual Regression — Font Sizes >> Font sizes: Card
- Location: tests/visual-regression.spec.ts:210:9

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 1
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - complementary [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e5]: A
      - generic [ref=e6]:
        - heading "AMASI" [level=1] [ref=e7]
        - paragraph [ref=e8]: Membership Management
    - navigation [ref=e9]:
      - generic [ref=e10]:
        - paragraph [ref=e11]: Admin
        - link "Dashboard" [ref=e12] [cursor=pointer]:
          - /url: /
          - img [ref=e13]
          - text: Dashboard
        - link "All Members" [ref=e18] [cursor=pointer]:
          - /url: /members
          - img [ref=e19]
          - text: All Members
        - link "Pending Actions" [ref=e24] [cursor=pointer]:
          - /url: /pending
          - img [ref=e25]
          - text: Pending Actions
        - link "Search Member" [ref=e29] [cursor=pointer]:
          - /url: /search
          - img [ref=e30]
          - text: Search Member
        - link "Reports" [ref=e33] [cursor=pointer]:
          - /url: /reports
          - img [ref=e34]
          - text: Reports
      - generic [ref=e36]:
        - paragraph [ref=e38]: Membership
        - link "Apply" [ref=e39] [cursor=pointer]:
          - /url: /apply
          - img [ref=e40]
          - text: Apply
        - link "Track Status" [ref=e43] [cursor=pointer]:
          - /url: /apply/status
          - img [ref=e44]
          - text: Track Status
        - link "Member Login" [ref=e49] [cursor=pointer]:
          - /url: /member
          - img [ref=e50]
          - text: Member Login
  - generic [ref=e53]:
    - banner [ref=e54]:
      - generic [ref=e56]:
        - img [ref=e57]
        - textbox "Search by email or phone..." [ref=e60]
      - generic [ref=e63]: P
    - main [ref=e64]:
      - generic [ref=e66]:
        - generic [ref=e67]:
          - generic [ref=e69]: A
          - generic [ref=e70]:
            - heading "AMASI" [level=1] [ref=e71]
            - paragraph [ref=e72]: Association of Minimal Access Surgeons of India
        - generic [ref=e74]:
          - generic [ref=e76]:
            - img [ref=e78]
            - generic [ref=e82]:
              - generic [ref=e83]:
                - generic [ref=e84]:
                  - img [ref=e86]
                  - generic [ref=e88]:
                    - paragraph [ref=e89]: AMASI
                    - paragraph [ref=e90]: Minimal Access Surgeons of India
                - generic [ref=e91]: ASSOCIATE LIFE MEMBER
              - generic [ref=e93]:
                - paragraph [ref=e94]: "18134"
                - paragraph [ref=e95]: Dr. Preethi K
                - paragraph [ref=e96]: MD OBG
              - generic [ref=e97]:
                - generic [ref=e98]:
                  - paragraph [ref=e99]: "MCI: 125324"
                  - paragraph [ref=e100]: Karnataka • South Zone
                  - paragraph [ref=e101]: Member since 2026
                  - paragraph [ref=e104]: No Voting Rights
                - img "QR" [ref=e106]
          - generic [ref=e107]:
            - button "Download Card" [ref=e108] [cursor=pointer]:
              - img [ref=e109]
              - text: Download Card
            - button "Share Link" [ref=e112] [cursor=pointer]:
              - img [ref=e113]
              - text: Share Link
          - generic [ref=e119]:
            - link "Edit Profile" [ref=e120] [cursor=pointer]:
              - /url: /profile?q=kpreethi282%40gmail.com
              - img [ref=e122]
              - generic [ref=e126]: Edit Profile
            - link "Certificate" [ref=e127] [cursor=pointer]:
              - /url: /member/certificate?id=18134
              - img [ref=e129]
              - generic [ref=e132]: Certificate
            - link "Verify" [ref=e133] [cursor=pointer]:
              - /url: https://membership.collegeofmas.org.in/verify?id=18134
              - img [ref=e135]
              - generic [ref=e138]: Verify
          - paragraph [ref=e139]: Scan the QR code on the card to verify membership online
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=e145] [cursor=pointer]:
    - img [ref=e146]
  - alert [ref=e149]
```

# Test source

```ts
  116 | ]
  117 | 
  118 | // ============================================================
  119 | // TEST 1: Screenshot every page (baseline)
  120 | // ============================================================
  121 | test.describe("Visual Regression — Screenshots", () => {
  122 |   for (const p of PAGES) {
  123 |     test(`Screenshot: ${p.name}`, async ({ page }) => {
  124 |       await page.goto(p.url)
  125 |       await page.waitForLoadState("networkidle")
  126 |       await page.waitForTimeout(2000) // Wait for animations
  127 | 
  128 |       // Take full page screenshot
  129 |       await page.screenshot({
  130 |         path: `test-results/screenshots/${p.name.replace(/\s/g, "-").toLowerCase()}.png`,
  131 |         fullPage: true,
  132 |       })
  133 | 
  134 |       // Verify page loaded (HTTP 200)
  135 |       console.log(`✅ ${p.name}: screenshot taken`)
  136 |     })
  137 |   }
  138 | })
  139 | 
  140 | // ============================================================
  141 | // TEST 2: Check overlapping elements on key pages
  142 | // ============================================================
  143 | test.describe("Visual Regression — Overlap Checks", () => {
  144 |   test("Apply page — no overlapping cards", async ({ page }) => {
  145 |     await page.goto("/apply")
  146 |     await page.waitForTimeout(3000)
  147 | 
  148 |     const issues = await checkOverlaps(page, [
  149 |       "h1", "h2", "form", "button", "input", ".rounded-lg", ".rounded-xl"
  150 |     ])
  151 | 
  152 |     for (const issue of issues) console.log(`⚠️ ${issue}`)
  153 |     console.log(`✅ Apply: ${issues.length} overlap issues`)
  154 |   })
  155 | 
  156 |   test("Profile edit — no overlapping sections", async ({ page }) => {
  157 |     await page.goto("/profile?q=amasi.india@gmail.com&admin=1")
  158 |     await page.waitForTimeout(5000)
  159 | 
  160 |     // Click edit
  161 |     const editBtn = page.getByRole("button", { name: /Edit/i })
  162 |     if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
  163 |       await editBtn.click()
  164 |       await page.waitForTimeout(2000)
  165 |     }
  166 | 
  167 |     // Expand all sections
  168 |     for (const section of ["Personal", "Address", "Education", "Medical", "Documents"]) {
  169 |       const header = page.locator(`text=${section}`).first()
  170 |       if (await header.isVisible().catch(() => false)) {
  171 |         await header.click()
  172 |         await page.waitForTimeout(300)
  173 |       }
  174 |     }
  175 | 
  176 |     await page.screenshot({
  177 |       path: "test-results/screenshots/profile-edit-all-open.png",
  178 |       fullPage: true,
  179 |     })
  180 | 
  181 |     console.log("✅ Profile edit: all sections expanded, screenshot taken")
  182 |   })
  183 | 
  184 |   test("Search result — no overlapping fields", async ({ page }) => {
  185 |     await page.goto("/search?q=kpreethi282@gmail.com")
  186 |     await page.waitForTimeout(4000)
  187 | 
  188 |     await page.screenshot({
  189 |       path: "test-results/screenshots/search-result.png",
  190 |       fullPage: true,
  191 |     })
  192 | 
  193 |     const issues = await checkOverlaps(page, ["h2", "h3", "h4", ".rounded-lg", "dl", "dd", "dt"])
  194 |     for (const issue of issues) console.log(`⚠️ ${issue}`)
  195 |     console.log(`✅ Search: ${issues.length} overlap issues`)
  196 |   })
  197 | })
  198 | 
  199 | // ============================================================
  200 | // TEST 3: Font size validation
  201 | // ============================================================
  202 | test.describe("Visual Regression — Font Sizes", () => {
  203 |   for (const p of [
  204 |     { url: "/apply", name: "Apply" },
  205 |     { url: "/profile?q=amasi.india@gmail.com&admin=1", name: "Profile" },
  206 |     { url: "/members", name: "Members" },
  207 |     { url: "/card?id=kpreethi282@gmail.com&direct=1", name: "Card" },
  208 |     { url: "/member", name: "Member Portal" },
  209 |   ]) {
  210 |     test(`Font sizes: ${p.name}`, async ({ page }) => {
  211 |       await page.goto(p.url)
  212 |       await page.waitForTimeout(3000)
  213 | 
  214 |       const issues = await checkFontSizes(page)
  215 |       for (const issue of issues) console.log(`⚠️ ${issue}`)
> 216 |       expect(issues.length).toBe(0)
      |                             ^ Error: expect(received).toBe(expected) // Object.is equality
  217 |       console.log(`✅ ${p.name}: all font sizes within spec`)
  218 |     })
  219 |   }
  220 | })
  221 | 
  222 | // ============================================================
  223 | // TEST 4: Layout shift / overflow checks
  224 | // ============================================================
  225 | test.describe("Visual Regression — Layout Shifts", () => {
  226 |   for (const p of PAGES.slice(0, 8)) {
  227 |     test(`Layout: ${p.name}`, async ({ page }) => {
  228 |       await page.goto(p.url)
  229 |       await page.waitForTimeout(3000)
  230 | 
  231 |       const issues = await checkLayoutShifts(page)
  232 |       for (const issue of issues) console.log(`⚠️ ${issue}`)
  233 | 
  234 |       // Allow max 2 minor shifts (scrollbars etc)
  235 |       expect(issues.length).toBeLessThanOrEqual(2)
  236 |       console.log(`✅ ${p.name}: ${issues.length} layout issues`)
  237 |     })
  238 |   }
  239 | })
  240 | 
  241 | // ============================================================
  242 | // TEST 5: Interactive form field test
  243 | // ============================================================
  244 | test.describe("Visual Regression — Form Interactions", () => {
  245 |   test("Profile edit — type in every field type", async ({ page }) => {
  246 |     await page.goto("/profile?q=amasi.india@gmail.com&admin=1")
  247 |     await page.waitForTimeout(5000)
  248 | 
  249 |     // Click edit
  250 |     const editBtn = page.getByRole("button", { name: /Edit/i })
  251 |     if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
  252 |       await editBtn.click()
  253 |       await page.waitForTimeout(2000)
  254 |     }
  255 | 
  256 |     let fieldsTested = 0
  257 |     let focusLost = 0
  258 | 
  259 |     // Test text inputs
  260 |     const textInputs = page.locator("input[type='text']:visible")
  261 |     const textCount = await textInputs.count()
  262 | 
  263 |     for (let i = 0; i < Math.min(textCount, 8); i++) {
  264 |       const input = textInputs.nth(i)
  265 |       const readonly = await input.getAttribute("readonly")
  266 |       if (readonly !== null) continue
  267 | 
  268 |       const before = await input.inputValue()
  269 |       await input.click()
  270 |       await page.keyboard.type("Z", { delay: 100 })
  271 |       const after = await input.inputValue()
  272 | 
  273 |       if (after.length > before.length || after.endsWith("Z") || after.includes("Z")) {
  274 |         fieldsTested++
  275 |         await input.fill(before) // restore
  276 |       } else {
  277 |         focusLost++
  278 |         console.log(`❌ Focus lost on text input ${i}: "${before}" → "${after}"`)
  279 |       }
  280 |     }
  281 | 
  282 |     // Test select dropdowns
  283 |     const selects = page.locator("select:visible")
  284 |     const selectCount = await selects.count()
  285 |     for (let i = 0; i < Math.min(selectCount, 3); i++) {
  286 |       const select = selects.nth(i)
  287 |       const options = await select.locator("option").count()
  288 |       if (options > 1) {
  289 |         fieldsTested++
  290 |       }
  291 |     }
  292 | 
  293 |     // Test date inputs
  294 |     const dateInputs = page.locator("input[type='date']:visible")
  295 |     const dateCount = await dateInputs.count()
  296 |     for (let i = 0; i < dateCount; i++) {
  297 |       const input = dateInputs.nth(i)
  298 |       if (await input.isVisible()) {
  299 |         await input.fill("1990-01-15")
  300 |         fieldsTested++
  301 |       }
  302 |     }
  303 | 
  304 |     console.log(`✅ Fields tested: ${fieldsTested}, Focus lost: ${focusLost}`)
  305 |     expect(focusLost).toBe(0)
  306 | 
  307 |     await page.screenshot({
  308 |       path: "test-results/screenshots/profile-form-tested.png",
  309 |       fullPage: true,
  310 |     })
  311 |   })
  312 | 
  313 |   test("Apply check — typing maintains focus", async ({ page }) => {
  314 |     await page.goto("/apply")
  315 |     await page.waitForTimeout(3000)
  316 | 
```