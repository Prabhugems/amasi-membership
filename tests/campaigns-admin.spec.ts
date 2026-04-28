import { test, expect } from "@playwright/test"

test.use({ storageState: "playwright/.auth/admin.json" })

test("admin campaigns page renders with template picker", async ({ page }) => {
  await page.goto("/campaigns")

  await expect(page.getByRole("heading", { name: /email campaigns/i })).toBeVisible()
  await expect(page.getByText(/total campaigns/i)).toBeVisible()
  await expect(page.getByText(/emails sent/i)).toBeVisible()
  await expect(page.getByText(/members updated/i)).toBeVisible()

  const select = page.locator("select")
  await expect(select).toBeVisible()
  await expect(select.locator("option")).toContainText([/select template/i, /profile update/i])
})
