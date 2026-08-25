import { expect, test } from "@playwright/test";

import { authenticateAs, currentSession, identityFixtures } from "./fixtures/identity";
import {
  cleanupEmailConfirmationFixture,
  confirmationFixture,
  waitForEmailConfirmationUrl,
} from "./helpers/email-confirmation";

test("root shows one unified login action", async ({ page }) => {
  await page.goto("/");
  const login = page.getByRole("link", { name: "로그인하기" });
  await expect(login).toHaveCount(1);
  await expect(page.getByRole("link", { name: "학생으로 로그인" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "교사로 로그인" })).toHaveCount(0);
  await login.click();
  await expect(page).toHaveURL(/\/login$/);
});

test("teacher login compatibility route converges without starting OAuth", async ({ page }) => {
  const oauthRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/auth/v1/authorize" || pathname === "/auth/teacher/start") {
      oauthRequests.push(request.url());
    }
  });

  await page.goto("/teacher/login");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  expect(oauthRequests).toEqual([]);
});

test("student confirms a real local signup email before password login", async ({ page }) => {
  cleanupEmailConfirmationFixture();
  try {
    await page.goto("/auth/signup");
    await page.getByLabel("이메일").fill(confirmationFixture.email);
    await page.getByLabel("비밀번호").fill(confirmationFixture.password);
    await page.getByRole("button", { name: "회원가입" }).click();
    await expect(page.getByRole("status")).toHaveText("인증 이메일을 확인한 뒤 계속해 주세요.");

    await page.goto("/login");
    await page.getByLabel("이메일").fill(confirmationFixture.email);
    await page.getByLabel("비밀번호").fill(confirmationFixture.password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "이메일 인증을 완료한 뒤 다시 로그인해 주세요." }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    const confirmationUrl = await waitForEmailConfirmationUrl(page.request);
    const confirmationResponse = await page.request.get(confirmationUrl.toString(), {
      maxRedirects: 0,
    });
    expect([302, 303]).toContain(confirmationResponse.status());

    await page.goto("/login");
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

  const response = await page.context().request.get("http://localhost:3216/student");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toContain("no-cache");
  expect(response.headers().expires).toBe("0");
  expect(response.headers().pragma).toBe("no-cache");
  const refreshed = await currentSession(page.context());
  expect(refreshed?.access_token).not.toBe(original.access_token);

  await page.goto("/student");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "기본 정보 등록" })).toBeVisible();
});

test("pending teacher is denied the teacher dashboard and sent to onboarding", async ({ page }) => {
  await authenticateAs(page.context(), "pendingTeacher");

  await page.goto("/teacher");

  await expect(page).toHaveURL(/\/onboarding$/);
});

test("approved teacher can access the teacher dashboard", async ({ page }) => {
  await authenticateAs(page.context(), "approvedTeacher");

  await page.goto("/teacher");

  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();
});

test("student and administrator continue according to their current role", async ({ page }) => {
  await authenticateAs(page.context(), "completeStudent");
  await page.goto("/auth/continue");
  await expect(page).toHaveURL(/\/student$/);

  await authenticateAs(page.context(), "admin");
  await page.goto("/auth/continue");
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();
});

test("logout cannot restore protected student history through Back", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await authenticateAs(context, "completeStudent");
    const page = await context.newPage();

    await page.goto("/student");
    await page.getByRole("link", { name: "QR 출결" }).click();
    await expect(page.getByRole("heading", { name: "QR로 출결하기" })).toBeVisible();
    await page.getByRole("link", { name: "홈" }).press("Enter");
    await expect(page.getByRole("heading", { name: "오늘 출결 상태" })).toBeVisible();
    await page.getByRole("button", { name: "로그아웃" }).click();
    await page.getByRole("button", { name: "로그아웃 확인" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goBack();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "오늘 출결 상태" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "QR로 출결하기" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("admin promotion updates the student badge and promoted password account continues to teacher", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const studentContext = await browser.newContext();
  try {
    const promotionTarget = identityFixtures.pendingTeacher;
    await authenticateAs(studentContext, "pendingTeacher");
    const student = await studentContext.newPage();
    await student.goto("/auth/continue");
    await expect(student).toHaveURL(/\/onboarding$/);
    await student.getByLabel("이름").fill("교사 승격 대상");
    await student.getByLabel("생년").fill("2011");
    await student.getByLabel("월").fill("06");
    await student.getByLabel("일").fill("07");
    await student.getByLabel("학생 연락처 앞자리").fill("010");
    await student.getByLabel("학생 연락처 중간자리").fill("1111");
    await student.getByLabel("학생 연락처 끝자리").fill("1004");
    await student.getByLabel("보호자 연락처 앞자리").fill("010");
    await student.getByLabel("보호자 연락처 중간자리").fill("9999");
    await student.getByLabel("보호자 연락처 끝자리").fill("0004");
    const profileResponse = student.waitForResponse((response) => (
      response.url().includes("/api/students/profile")
      && response.request().method() === "POST"
    ));
    await student.getByRole("button", { name: "가입 완료" }).click();
    expect((await profileResponse).status()).toBe(201);
    await expect(student).toHaveURL(/\/student$/);

    await authenticateAs(adminContext, "admin");
    const admin = await adminContext.newPage();

    await admin.goto(`/teacher/students?query=${encodeURIComponent(promotionTarget.email)}&statistics=all`);
    const row = admin.getByRole("row").filter({ hasText: "교사 승격 대상" });
    await expect(row).toBeVisible();
    await expect(row.getByText("학생", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "교사 승격 대상 수정" }).click();

    const editor = admin.getByRole("dialog", { name: "교사 승격 대상 학생 정보 수정" });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "교사 권한 추가" }).click();
    const confirmation = admin.getByRole("alertdialog", { name: "교사 권한 추가" });
    await expect(confirmation).toBeVisible();
    const promotionResponse = admin.waitForResponse((response) => (
      response.url().includes(`/api/admin/students/${promotionTarget.id}/promote-to-teacher`)
      && response.request().method() === "POST"
    ));
    await confirmation.getByRole("button", { name: "권한 추가" }).click();
    expect((await promotionResponse).status()).toBe(200);
    await expect(editor.getByText("교사", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "닫기" }).click();
    await expect(editor).toBeHidden();
    await expect(row.getByText("교사", { exact: true })).toBeVisible();

    await authenticateAs(studentContext, "pendingTeacher");
    await student.goto("/auth/continue");
    await expect(student).toHaveURL(/\/teacher$/);
    await expect(student.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();
  } finally {
    await Promise.all([adminContext.close(), studentContext.close()]);
  }
});

test("administrator pages reject teachers and allow administrators", async ({ page }) => {
  await authenticateAs(page.context(), "approvedTeacher");
  await page.goto("/teacher/applications");
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();

  await authenticateAs(page.context(), "admin");
  await page.goto("/teacher/applications");
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();

  await page.goto("/admin/staff");
  await expect(page.getByRole("heading", { name: "교직원 역할 관리" })).toBeVisible();
  await expect(page.getByText("초기 관리자")).toBeVisible();
});
