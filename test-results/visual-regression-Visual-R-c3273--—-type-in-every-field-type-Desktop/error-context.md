# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: visual-regression.spec.ts >> Visual Regression — Form Interactions >> Profile edit — type in every field type
- Location: tests/visual-regression.spec.ts:245:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 1
```

# Page snapshot

```yaml
- generic [ref=e1]:
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
            - paragraph [ref=e72]: Member Profile
        - generic [ref=e74]:
          - generic [ref=e75]:
            - generic [ref=e76]:
              - heading "Edit Profile" [level=2] [ref=e77]
              - paragraph [ref=e78]: "AMASI #16311 · amasi.india@gmail.com"
            - generic [ref=e79]:
              - button "Cancel" [ref=e80] [cursor=pointer]
              - button "Review Changes" [ref=e81] [cursor=pointer]
          - generic [ref=e84]:
            - generic [ref=e85]: Profile Completeness
            - generic [ref=e86]: 100%
          - generic [ref=e89]:
            - button "Personal Information" [ref=e90]:
              - generic [ref=e91]:
                - img [ref=e93]
                - generic [ref=e97]:
                  - generic [ref=e98]: Personal Information
                  - img [ref=e99]
              - img [ref=e102]
            - generic [ref=e105]:
              - generic [ref=e106]:
                - img "Profile" [ref=e108]
                - generic [ref=e109] [cursor=pointer]:
                  - generic:
                    - img
                    - text: Change Photo
                - paragraph [ref=e110]: JPG or PNG, max 2 MB
              - generic [ref=e111]:
                - generic [ref=e112]:
                  - generic [ref=e113]:
                    - generic [ref=e114]:
                      - img [ref=e115]
                      - generic [ref=e118]: Member Profile
                    - paragraph [ref=e119]: Dr. Prabhu B
                    - generic [ref=e120]:
                      - generic [ref=e121]:
                        - img [ref=e122]
                        - text: AMASI 16311
                      - generic [ref=e125]:
                        - img [ref=e126]
                        - text: amasi.india@gmail.com
                  - generic [ref=e129]: ALM
                - paragraph [ref=e130]: Contact the admin to update your name
              - generic [ref=e133]: Details
              - generic [ref=e135]:
                - generic [ref=e136]:
                  - generic [ref=e137]: Date of Birth *
                  - generic [ref=e138]:
                    - textbox [active] [ref=e139]: 1990-01-15
                    - generic [ref=e140]: "Age: 36 yrs"
                - generic [ref=e141]:
                  - generic [ref=e142]: Father's Name
                  - textbox "e.g. Rajesh Kumar" [ref=e143]: Balasubramaniam
              - generic [ref=e144]:
                - generic [ref=e145]: Gender *
                - generic [ref=e146]:
                  - button "Male" [ref=e147]
                  - button "Female" [ref=e148]
                  - button "Others" [ref=e149]
              - generic [ref=e151]:
                - generic [ref=e152]: Nationality
                - combobox [ref=e153]:
                  - option "Select..."
                  - option "Indian" [selected]
                  - option "Nepalese"
                  - option "Sri Lankan"
                  - option "Bangladeshi"
                  - option "Other"
          - generic [ref=e154]:
            - button "Address" [ref=e155]:
              - generic [ref=e156]:
                - img [ref=e158]
                - generic [ref=e162]:
                  - generic [ref=e163]: Address
                  - img [ref=e164]
              - img [ref=e167]
            - generic [ref=e171]:
              - generic [ref=e172]:
                - generic [ref=e173]:
                  - img [ref=e174]
                  - text: Enter PIN Code to auto-fill city & state
                - paragraph [ref=e177]: Type a 6-digit Indian PIN code for instant lookup
                - textbox "e.g. 641045" [ref=e180]: "641045"
              - generic [ref=e181]:
                - generic [ref=e182]:
                  - generic [ref=e183]: City *
                  - textbox "e.g. Coimbatore" [ref=e184]: Coimbatore
                - generic [ref=e185]:
                  - generic [ref=e186]: State *
                  - generic [ref=e187]:
                    - textbox "Search state..." [ref=e188]: Tamil Nadu
                    - img [ref=e189]
                - generic [ref=e192]:
                  - text: Zone
                  - generic [ref=e194]: South Zone
              - generic [ref=e195]:
                - generic [ref=e196]:
                  - generic [ref=e197]: Street Address Line 1
                  - textbox "e.g. 42, MG Road" [ref=e198]: testing
                - generic [ref=e199]:
                  - generic [ref=e200]: Street Address Line 2
                  - textbox "e.g. Near City Hospital, Peelamedu" [ref=e201]: testing
              - generic [ref=e203]:
                - generic [ref=e204]: Country
                - combobox [ref=e205]:
                  - option "Select..."
                  - option "India" [selected]
                  - option "Nepal"
                  - option "Sri Lanka"
                  - option "Bangladesh"
                  - option "United States"
                  - option "United Kingdom"
                  - option "Canada"
                  - option "Australia"
                  - option "United Arab Emirates"
                  - option "Saudi Arabia"
                  - option "Singapore"
                  - option "Malaysia"
                  - option "Germany"
                  - option "Other"
          - generic [ref=e206]:
            - button "Education" [ref=e207]:
              - generic [ref=e208]:
                - img [ref=e210]
                - generic [ref=e214]:
                  - generic [ref=e215]: Education
                  - img [ref=e216]
              - img [ref=e219]
            - generic [ref=e223]:
              - generic [ref=e224]:
                - generic [ref=e225]:
                  - img [ref=e227]
                  - heading "Undergraduate (MBBS)" [level=4] [ref=e229]
                - generic [ref=e230]:
                  - generic [ref=e231]:
                    - text: Degree
                    - textbox "MBBS" [ref=e232]
                  - generic [ref=e233]:
                    - text: College
                    - generic [ref=e234]:
                      - textbox "Type 2+ characters to search 757 medical colleges" [ref=e236]: Testing
                      - img
                  - generic [ref=e237]:
                    - text: University
                    - textbox "Auto-fills from college selection" [ref=e238]: Testing
                  - generic [ref=e239]:
                    - generic [ref=e240]: Year of Passing
                    - combobox [ref=e241]:
                      - option "Select..."
                      - option "2026"
                      - option "2025"
                      - option "2024"
                      - option "2023"
                      - option "2022"
                      - option "2021"
                      - option "2020" [selected]
                      - option "2019"
                      - option "2018"
                      - option "2017"
                      - option "2016"
                      - option "2015"
                      - option "2014"
                      - option "2013"
                      - option "2012"
                      - option "2011"
                      - option "2010"
                      - option "2009"
                      - option "2008"
                      - option "2007"
                      - option "2006"
                      - option "2005"
                      - option "2004"
                      - option "2003"
                      - option "2002"
                      - option "2001"
                      - option "2000"
                      - option "1999"
                      - option "1998"
                      - option "1997"
                      - option "1996"
                      - option "1995"
                      - option "1994"
                      - option "1993"
                      - option "1992"
                      - option "1991"
                      - option "1990"
                      - option "1989"
                      - option "1988"
                      - option "1987"
                      - option "1986"
                      - option "1985"
                      - option "1984"
                      - option "1983"
                      - option "1982"
                      - option "1981"
                      - option "1980"
                      - option "1979"
                      - option "1978"
                      - option "1977"
              - generic [ref=e242]:
                - generic [ref=e243]:
                  - img [ref=e245]
                  - heading "Postgraduate Degree *" [level=4] [ref=e248]
                - generic [ref=e249]:
                  - generic [ref=e250]: PG Degree *
                  - generic [ref=e251]:
                    - button "MS General Surgery" [ref=e252]
                    - button "MS Obstetrics & Gynaecology" [ref=e253]
                    - button "MCh" [ref=e254]
                    - button "DNB General Surgery" [ref=e255]
                    - button "FRCS" [ref=e256]
                    - button "Other" [ref=e257]:
                      - img [ref=e258]
                      - text: Other
                  - generic [ref=e262]:
                    - generic [ref=e263]: Select or type your PG Degree
                    - generic [ref=e264]:
                      - textbox "Search select or type your pg degree..." [ref=e265]: Testing
                      - img [ref=e266]
                - generic [ref=e269]:
                  - generic [ref=e270]:
                    - text: PG College
                    - generic [ref=e271]:
                      - textbox "Type 2+ characters to search 757 medical colleges" [ref=e273]: Testing
                      - img
                  - generic [ref=e274]:
                    - text: PG University
                    - textbox "Auto-fills from college selection" [ref=e275]: Testing
                  - generic [ref=e276]:
                    - generic [ref=e277]: PG Year of Passing
                    - combobox [ref=e278]:
                      - option "Select..."
                      - option "2026"
                      - option "2025"
                      - option "2024" [selected]
                      - option "2023"
                      - option "2022"
                      - option "2021"
                      - option "2020"
                      - option "2019"
                      - option "2018"
                      - option "2017"
                      - option "2016"
                      - option "2015"
                      - option "2014"
                      - option "2013"
                      - option "2012"
                      - option "2011"
                      - option "2010"
                      - option "2009"
                      - option "2008"
                      - option "2007"
                      - option "2006"
                      - option "2005"
                      - option "2004"
                      - option "2003"
                      - option "2002"
                      - option "2001"
                      - option "2000"
                      - option "1999"
                      - option "1998"
                      - option "1997"
                      - option "1996"
                      - option "1995"
                      - option "1994"
                      - option "1993"
                      - option "1992"
                      - option "1991"
                      - option "1990"
                      - option "1989"
                      - option "1988"
                      - option "1987"
                      - option "1986"
                      - option "1985"
                      - option "1984"
                      - option "1983"
                      - option "1982"
                      - option "1981"
                      - option "1980"
                      - option "1979"
                      - option "1978"
                      - option "1977"
              - button "Add Super Specialty (optional)" [ref=e279]:
                - img [ref=e280]
                - text: Add Super Specialty (optional)
              - generic [ref=e281]:
                - paragraph [ref=e282]: Education Summary
                - paragraph [ref=e283]: Testing — Testing (2024)
                - paragraph [ref=e284]: MBBS — Testing (2020)
          - generic [ref=e285]:
            - button "Medical Registration" [ref=e286]:
              - generic [ref=e287]:
                - img [ref=e289]
                - generic [ref=e293]:
                  - generic [ref=e294]: Medical Registration
                  - img [ref=e295]
              - img [ref=e298]
            - generic [ref=e303]:
              - heading "MCI / State Medical Council" [level=4] [ref=e304]
              - generic [ref=e306]:
                - generic [ref=e307]:
                  - img [ref=e309]
                  - generic [ref=e312]:
                    - generic [ref=e313]:
                      - text: MCI/Council Number
                      - img [ref=e314]
                    - paragraph [ref=e317]: "123456"
                - generic [ref=e319]:
                  - img [ref=e320]
                  - text: Certificate Verified
              - generic [ref=e323]:
                - generic [ref=e324]:
                  - generic [ref=e325]: MCI Council State
                  - generic [ref=e326]:
                    - textbox "Search mci council state..." [ref=e327]: Tamil Nadu
                    - img [ref=e328]
                - generic [ref=e331]:
                  - generic [ref=e332]:
                    - text: IMR Registration No
                    - generic [ref=e333]:
                      - img [ref=e334]
                      - generic: Indian Medical Register number from NMC
                  - textbox "e.g. 123456" [ref=e336]: "65465"
          - generic [ref=e337]:
            - button "Documents" [ref=e338]:
              - generic [ref=e339]:
                - img [ref=e341]
                - generic [ref=e345]:
                  - generic [ref=e346]: Documents
                  - img [ref=e347]
              - img [ref=e350]
            - generic [ref=e353]:
              - generic [ref=e356]:
                - generic [ref=e357]: All documents complete
                - img [ref=e358]
              - generic [ref=e363]:
                - generic [ref=e364]:
                  - generic [ref=e365]:
                    - img "Profile Photo" [ref=e366]
                    - generic [ref=e367]:
                      - paragraph [ref=e368]: Profile Photo
                      - generic [ref=e369]:
                        - img [ref=e370]
                        - generic [ref=e373]: Uploaded
                  - generic [ref=e374]:
                    - link "View" [ref=e375] [cursor=pointer]:
                      - /url: https://member2025.s3.ap-south-1.amazonaws.com/certificates/1754980161540_logo.png-1742364951302.png
                      - img [ref=e376]
                      - text: View
                    - generic [ref=e380] [cursor=pointer]:
                      - img [ref=e381]
                      - text: Replace
                - generic [ref=e386]:
                  - generic [ref=e387]:
                    - img [ref=e389]
                    - generic [ref=e392]:
                      - paragraph [ref=e393]: MCI Certificate
                      - generic [ref=e394]:
                        - img [ref=e395]
                        - generic [ref=e398]: Uploaded
                  - generic [ref=e399]:
                    - link "View" [ref=e400] [cursor=pointer]:
                      - /url: https://member2025.s3.ap-south-1.amazonaws.com/certificates/1748933774012_AMASI.pdf
                      - img [ref=e401]
                      - text: View
                    - generic [ref=e405] [cursor=pointer]:
                      - img [ref=e406]
                      - text: Replace
                - generic [ref=e411]:
                  - generic [ref=e412]:
                    - img "PG Degree Certificate" [ref=e413]
                    - generic [ref=e414]:
                      - paragraph [ref=e415]: PG Degree Certificate
                      - generic [ref=e416]:
                        - img [ref=e417]
                        - generic [ref=e420]: Uploaded
                  - generic [ref=e421]:
                    - link "View" [ref=e422] [cursor=pointer]:
                      - /url: https://member2025.s3.ap-south-1.amazonaws.com/certificates/1748933774107_amasi.enhance.events_admin_testing-09-05_attendees.png
                      - img [ref=e423]
                      - text: View
                    - generic [ref=e427] [cursor=pointer]:
                      - img [ref=e428]
                      - text: Replace
          - generic [ref=e433]:
            - paragraph [ref=e434]: Changes are saved only after review and OTP verification.
            - generic [ref=e435]:
              - button "Cancel" [ref=e436] [cursor=pointer]
              - button "Review Changes" [ref=e437] [cursor=pointer]
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=e443] [cursor=pointer]:
    - img [ref=e444]
  - alert [ref=e447]
```

# Test source

```ts
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
  216 |       expect(issues.length).toBe(0)
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
> 305 |     expect(focusLost).toBe(0)
      |                       ^ Error: expect(received).toBe(expected) // Object.is equality
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
  317 |     const input = page.locator("input[placeholder*='Email, mobile']")
  318 |     await input.click()
  319 |     await page.keyboard.type("fulltest@doctor.com", { delay: 50 })
  320 |     const val = await input.inputValue()
  321 |     expect(val).toBe("fulltest@doctor.com")
  322 | 
  323 |     console.log(`✅ Apply check input: focus maintained, typed "${val}"`)
  324 |   })
  325 | })
  326 | 
```