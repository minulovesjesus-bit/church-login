import { expect, test } from "@playwright/test";

import { authenticateAs, currentSession } from "./fixtures/identity";
import {
  cleanupEmailConfirmationFixture,
  confirmationFixture,
  waitForEmailConfirmationUrl,
} from "./helpers/email-confirmation";

test("root routes users to separate student and teacher entry points", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "학생으로 로그인" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);

  await page.goto("/");
  await page.getByRole("link", { name: "교사로 로그인" }).click();
  await expect(page).toHaveURL(/\/teacher\/login$/);
});

test("student confirms a real local signup email before password login", async ({ page }) => {
  cleanupEmailConfirmationFixture();
  try {
    await page.goto("/auth/signup");
    await page.getByLabel("이메일").fill(confirmationFixture.email);
    await page.getByLabel("비밀번호").fill(confirmationFixture.password);
    await page.getByRole("button", { name: "회원가입" }).click();
    await expect(page.getByRole("status")).toHaveText("인증 이메일을 확인한 뒤 계속해 주세요.");

    await page.goto("/auth/login");
    await page.getByLabel("이메일").fill(confirmationFixture.email);
    await page.getByLabel("비밀번호").fill(confirmationFixture.password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /Email not confirmed/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login$/);

    const confirmationUrl = await waitForEmailConfirmationUrl(page.request);
    const confirmationResponse = await page.request.get(confirmationUrl.toString(), {
      maxRedirects: 0,
    });
    expect([302, 303]).toContain(confirmationResponse.status());

    await page.goto("/auth/login");
    await page.getByLabel("이메일").fill(confirmationFixture.email);
    await page.getByLabel("비밀번호").fill(confirmationFixture.password);
    const confirmedLogin = page.waitForResponse((response) => (
      response.url().includes("/auth/v1/token?grant_type=password")
      && response.request().method() === "POST"
    ));
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    const confirmedResponse = await confirmedLogin;
    expect(confirmedResponse.status()).toBe(200);
    const confirmedBody = await confirmedResponse.json() as {
      access_token?: string;
      user?: { email?: string; email_confirmed_at?: string };
    };
    expect(confirmedBody.access_token).toBeTruthy();
    expect(confirmedBody.user?.email).toBe(confirmationFixture.email);
    expect(confirmedBody.user?.email_confirmed_at).toBeTruthy();
    await expect.poll(async () => (
      (await currentSession(page.context()))?.user.email
    )).toBe(confirmationFixture.email);
  } finally {
    cleanupEmailConfirmationFixture();
  }
});

test("protected student request refreshes cookies before onboarding redirect", async ({ page }) => {
  const original = await authenticateAs(page.context(), "incompleteStudent", { expired: true });

  const response = await page.context().request.get("http://127.0.0.1:3216/student");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toContain("no-cache");
  expect(response.headers().expires).toBe("0");
  expect(response.headers().pragma).toBe("no-cache");
  const refreshed = await currentSession(page.context());
  expect(refreshed?.access_token).not.toBe(original.access_token);

  await page.goto("/student");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "학생 정보 등록" })).toBeVisible();
});

test("pending teacher is denied the teacher dashboard", async ({ page }) => {
  await authenticateAs(page.context(), "pendingTeacher");

  await page.goto("/teacher");

  await expect(page).toHaveURL(/\/teacher\/apply$/);
  await expect(page.getByText("교사 가입 승인을 기다리고 있습니다.")).toBeVisible();
});

test("approved teacher can access the teacher dashboard", async ({ page }) => {
  await authenticateAs(page.context(), "approvedTeacher");

  await page.goto("/teacher");

  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();
});

test("administrator pages reject teachers and allow administrators", async ({ page }) => {
  await authenticateAs(page.context(), "approvedTeacher");
  await page.goto("/teacher/applications");
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();

  await authenticateAs(page.context(), "admin");
  await page.goto("/teacher/applications");
  await expect(page.getByRole("heading", { name: "교사 가입 신청 관리" })).toBeVisible();
  await expect(page.getByText("승인 대기 교사")).toBeVisible();

  await page.goto("/admin/staff");
  await expect(page.getByRole("heading", { name: "교직원 역할 관리" })).toBeVisible();
  await expect(page.getByText("초기 관리자")).toBeVisible();
});
