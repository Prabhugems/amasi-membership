import { test as setup, expect } from "@playwright/test"
import { loadEnvConfig } from "@next/env"
import path from "node:path"

loadEnvConfig(process.cwd())

const ADMIN_AUTH_FILE = path.join(process.cwd(), "playwright/.auth/admin.json")

setup("authenticate as admin", async ({ request }) => {
  const email = process.env.ADMIN_DEFAULT_EMAIL
  const password = process.env.ADMIN_DEFAULT_PASSWORD
  if (!email || !password) {
    throw new Error(
      "ADMIN_DEFAULT_EMAIL / ADMIN_DEFAULT_PASSWORD must be set in .env.local for the auth fixture",
    )
  }

  const res = await request.post("http://localhost:3000/api/auth/login", {
    data: { email, password },
  })
  expect(res.ok(), `login failed: ${res.status()} ${await res.text()}`).toBeTruthy()
  const body = await res.json()
  expect(body.status).toBe(true)
  expect(body.requires2fa, "env-admin path should not require 2FA").toBeFalsy()

  await request.storageState({ path: ADMIN_AUTH_FILE })
})
