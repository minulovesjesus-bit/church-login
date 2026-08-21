import { expect, test } from "@playwright/test";

import { authenticateAs, currentSession } from "./fixtures/identity";

test("root routes users to separate student and teacher entry points", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "학생으로 로그인" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);

  await page.goto("/");
  await page.getByRole("link", { name: "교사로 로그인" }).click();
  await expect(page).toHaveURL(/\/teacher\/login$/);
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
  await expect(page.getByText("이 작업을 수행할 권한이 없습니다.")).toBeVisible();

  await authenticateAs(page.context(), "admin");
  await page.goto("/teacher/applications");
  await expect(page.getByRole("heading", { name: "교사 가입 신청 관리" })).toBeVisible();
  await expect(page.getByText("승인 대기 교사")).toBeVisible();

  await page.goto("/admin/staff");
  await expect(page.getByRole("heading", { name: "교직원 역할 관리" })).toBeVisible();
  await expect(page.getByText("초기 관리자")).toBeVisible();
});
