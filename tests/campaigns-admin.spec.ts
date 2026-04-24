import { test, expect } from "@playwright/test"

// Smoke: admin can load the campaigns page, see the template picker, and the
// stats cards render. Does not perform an actual send (would email real members).

test("admin campaigns page renders with template picker", async ({ page }) => {
  // Prereq: admin auth fixture. If this repo has one (see other specs),
  // use the same pattern; otherwise stub with cookies.
  await page.goto("/campaigns")

  await expect(page.getByRole("heading", { name: /email campaigns/i })).toBeVisible()
  await expect(page.getByText(/total campaigns/i)).toBeVisible()
  await expect(page.getByText(/emails sent/i)).toBeVisible()
  await expect(page.getByText(/members updated/i)).toBeVisible()

  const select = page.locator("select")
  await expect(select).toBeVisible()
  const options = await select.locator("option").allTextContents()
  expect(options.some((o) => /profile update/i.test(o))).toBe(true)
})
