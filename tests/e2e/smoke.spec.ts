import { expect, test } from "@playwright/test"

test("homepage returns 200 and renders", async ({ page }) => {
  const response = await page.goto("/")
  expect(response?.status()).toBe(200)
  await expect(page.locator("body")).not.toBeEmpty()
})
