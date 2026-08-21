import { expect, type Browser, type Page } from "@playwright/test";

import {
  advanceTestClock,
  submitDecodedQr,
  unlockKiosk,
  waitForFreshRenderedQrToken,
} from "./attendance";
import { authenticateAs, identityFixtures } from "../fixtures/identity";

const STUDENT_NAME = "전체 흐름 학생";
const TEACHER_NAME = "전체 흐름 교사";
const ACCEPTED_REQUEST_IDS = [
  "00000000-0000-4000-8000-000000000901",
  "00000000-0000-4000-8000-000000000903",
  "00000000-0000-4000-8000-000000000904",
  "00000000-0000-4000-8000-000000000905",
] as const;
const COOLDOWN_REQUEST_ID = "00000000-0000-4000-8000-000000000902";
const EXPIRED_REQUEST_ID = "00000000-0000-4000-8000-000000000906";

type KioskJourneyState = {
  sessionId: string;
  token: string;
  acceptedScans: number;
};

const kioskJourney = new WeakMap<Page, KioskJourneyState>();

export type TeacherApplicant = {
  email: string;
  name: string;
  page: Page;
};

export type AggregateExclusion = {
  before: number;
  after: number;
  restore: () => Promise<void>;
};

function requireFixtureEmail(email: string): "fullSystemStudent" | "fullSystemTeacher" {
  if (email === identityFixtures.fullSystemStudent.email) return "fullSystemStudent";
  if (email === identityFixtures.fullSystemTeacher.email) return "fullSystemTeacher";
  throw new Error(`No dedicated full-system fixture exists for ${email}`);
}

function seoulCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function dashboardTargetCount(page: Page): Promise<number> {
  const summary = page.getByText(/^통계 대상 \d+명$/);
  await expect(summary).toBeVisible();
  const match = (await summary.textContent())?.match(/(\d+)/);
  if (!match) throw new Error("Teacher dashboard did not expose the statistics target count.");
  return Number(match[1]);
}

async function editStudentStatistics(page: Page, email: string, included: boolean): Promise<void> {
  await page.goto(`/teacher/students?query=${encodeURIComponent(email)}&statistics=all`);
  const row = page.getByRole("table", { name: "학생 목록" }).locator("tr").filter({
    has: page.getByText(email, { exact: true }),
  });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `${STUDENT_NAME} 수정` }).click();
  await expect(page.getByRole("heading", { name: "학생 정보 수정" })).toBeVisible();
  await page.getByRole("radio", {
    name: included ? "통계 포함" : "통계 제외",
    exact: true,
  }).click();
  const updated = page.waitForResponse((response) => (
    response.url().includes(`/api/teacher/students/${identityFixtures.fullSystemStudent.id}`)
    && response.request().method() === "PATCH"
  ));
  await page.getByRole("button", { name: "학생 정보 저장" }).click();
  expect((await updated).ok()).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "학생 정보를 수정했습니다." })).toBeVisible();
}

async function submitRejectedDecodedQr(
  page: Page,
  token: string,
  requestId: string,
  expectedCode: string,
): Promise<void> {
  const scanAgain = page.getByRole("button", { name: "새 QR 스캔" });
  if (await scanAgain.isVisible().catch(() => false)) await scanAgain.click();
  await expect(page.getByText("QR 코드를 화면 안에 맞춰 주세요")).toBeVisible();
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes("/api/attendance/scan")
    && response.request().method() === "POST"
  ));
  await page.evaluate(({ value, id }) => {
    const originalRandomUuid = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => id });
    window.dispatchEvent(new CustomEvent("attendance:test-qr", { detail: value }));
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: originalRandomUuid });
  }, { value: token, id: requestId });
  const response = await responsePromise;
  expect(response.ok()).toBe(false);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe(expectedCode);
}

export async function createVerifiedStudent(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  await authenticateAs(context, requireFixtureEmail(email));
  const page = await context.newPage();
  await page.goto("/student");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("이름").fill(STUDENT_NAME);
  await page.getByLabel("생년월일").fill("2012-04-05");
  await page.getByLabel("학생 연락처").fill("01011111003");
  await page.getByLabel("보호자 연락처").fill("01099990003");
  const profileResponse = page.waitForResponse((response) => (
    response.url().includes("/api/students/profile")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "가입 완료" }).click();
  expect((await profileResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { name: "오늘 출결 상태" })).toBeVisible();
  return page;
}

export async function submitTeacherApplication(
  browser: Browser,
  email: string,
): Promise<TeacherApplicant> {
  const context = await browser.newContext();
  await authenticateAs(context, requireFixtureEmail(email));
  const page = await context.newPage();
  await page.goto("/teacher/apply");
  await expect(page.getByRole("heading", { name: "교사 가입 신청" })).toBeVisible();
  await page.getByLabel("이름").fill(TEACHER_NAME);
  await page.getByLabel("연락처").fill("01011112003");
  const applicationResponse = page.waitForResponse((response) => (
    response.url().includes("/api/teacher-applications")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "교사 가입 신청" }).click();
  expect((await applicationResponse).status()).toBe(201);
  await expect(page.getByText("교사 가입 승인을 기다리고 있습니다.")).toBeVisible();
  return { email, name: TEACHER_NAME, page };
}

export async function approveTeacherAndPromoteAdmin(
  browser: Browser,
  applicant: TeacherApplicant,
): Promise<Page> {
  const adminContext = await browser.newContext();
  await authenticateAs(adminContext, "admin");
  const adminPage = await adminContext.newPage();
  await adminPage.goto("/teacher/applications");
  const application = adminPage.getByRole("listitem").filter({
    has: adminPage.getByText(applicant.email, { exact: true }),
  });
  await expect(application).toBeVisible();
  adminPage.once("dialog", (dialog) => dialog.accept());
  const approvalResponse = adminPage.waitForResponse((response) => (
    response.url().includes("/api/admin/teacher-applications/")
    && response.url().endsWith("/approve")
    && response.request().method() === "POST"
  ));
  await application.getByRole("button", { name: "승인" }).click();
  expect((await approvalResponse).ok()).toBe(true);
  await expect(adminPage.getByRole("status").filter({ hasText: "신청을 승인했습니다." })).toBeVisible();

  await adminPage.goto("/admin/staff");
  const staff = adminPage.getByRole("listitem").filter({
    has: adminPage.getByText(applicant.email, { exact: true }),
  });
  await expect(staff).toBeVisible();
  adminPage.once("dialog", (dialog) => dialog.accept());
  const promotionResponse = adminPage.waitForResponse((response) => (
    response.url().includes(`/api/admin/staff/${identityFixtures.fullSystemTeacher.id}/role`)
    && response.request().method() === "PATCH"
  ));
  await staff.getByRole("button", { name: "관리자로 승격" }).click();
  expect((await promotionResponse).ok()).toBe(true);
  await expect(adminPage.getByRole("status").filter({ hasText: "관리자로 변경했습니다." })).toBeVisible();

  await applicant.page.goto("/teacher");
  await expect(applicant.page.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();
  await adminPage.goto("/teacher");
  await expect(adminPage.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();
  return adminPage;
}

export async function unlockSharedDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const unlocked = await unlockKiosk(page);
  kioskJourney.set(page, {
    sessionId: unlocked.sessionId,
    token: unlocked.token,
    acceptedScans: 0,
  });
  return page;
}

export async function scanKioskQr(studentPage: Page, kioskPage: Page): Promise<void> {
  const state = kioskJourney.get(kioskPage);
  if (!state) throw new Error("The shared device must be unlocked before scanning.");
  if (state.acceptedScans >= ACCEPTED_REQUEST_IDS.length) {
    throw new Error("The full-system journey defines exactly four accepted scans.");
  }
  if (!new URL(studentPage.url()).pathname.startsWith("/student/scan")) {
    await studentPage.goto("/student/scan");
  }

  if (state.acceptedScans === 1) {
    const cooldown = await submitDecodedQr(studentPage, state.token, COOLDOWN_REQUEST_ID);
    expect(cooldown.direction).toBe("IN");
    expect(cooldown.cooldown_remaining).not.toBeNull();
    await expect(studentPage.getByRole("heading", { name: "잠시만 기다려 주세요" })).toBeVisible();
    const accessCookie = (await kioskPage.context().cookies()).find((cookie) => cookie.name === "kiosk_access");
    if (!accessCookie) throw new Error("The unlocked kiosk did not store its access cookie.");
    await kioskPage.context().addCookies([{
      name: accessCookie.name,
      value: "expired-access-token",
      domain: accessCookie.domain,
      path: accessCookie.path,
      httpOnly: accessCookie.httpOnly,
      secure: accessCookie.secure,
      sameSite: accessCookie.sameSite,
    }]);
    const refreshResponse = kioskPage.waitForResponse((response) => (
      response.url().includes("/api/kiosk/sessions/refresh")
      && response.request().method() === "POST"
    ));
    const previousToken = state.token;
    const [refresh, freshToken] = await Promise.all([
      refreshResponse,
      waitForFreshRenderedQrToken(kioskPage, previousToken),
    ]);
    expect(refresh.ok()).toBe(true);
    state.token = freshToken;
    await submitRejectedDecodedQr(studentPage, previousToken, EXPIRED_REQUEST_ID, "QR_EXPIRED");
  } else if (state.acceptedScans === 2) {
    await advanceTestClock(10_100);
  } else if (state.acceptedScans === 3) {
    const freshToken = waitForFreshRenderedQrToken(kioskPage, state.token);
    await advanceTestClock(10_100);
    state.token = await freshToken;
  }

  const expectedDirection = state.acceptedScans % 2 === 0 ? "IN" : "OUT";
  const result = await submitDecodedQr(
    studentPage,
    state.token,
    ACCEPTED_REQUEST_IDS[state.acceptedScans],
  );
  expect(result.direction).toBe(expectedDirection);
  expect(result.cooldown_remaining).toBeNull();
  state.acceptedScans += 1;
}

export async function expectTeacherAttendance(
  browser: Browser,
  email: string,
  state: string,
): Promise<void> {
  const context = await browser.newContext();
  try {
    await authenticateAs(context, "fullSystemTeacher");
    const page = await context.newPage();
    await page.goto("/teacher");
    await expect(page.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();
    await expect(
      page.locator(".attendance-desktop-only").getByText(email, { exact: true }).first(),
    ).toBeVisible();
    if (state === "입실 중") {
      await expect(page.getByText(/^현재 입실 1명$/)).toBeVisible();
    }
    await page.goto(`/teacher/attendance?search=${encodeURIComponent(email)}`);
    const row = page.locator(".attendance-desktop-only tr").filter({
      has: page.getByText(email, { exact: true }),
    }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText(state === "입실 중" ? "입실" : "퇴실", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
}

export async function excludeStudentFromAggregates(
  browser: Browser,
  email: string,
): Promise<AggregateExclusion> {
  const context = await browser.newContext();
  try {
    await authenticateAs(context, "fullSystemTeacher");
    const page = await context.newPage();
    await page.goto("/teacher");
    const before = await dashboardTargetCount(page);
    await editStudentStatistics(page, email, false);
    await page.goto("/teacher");
    const after = await dashboardTargetCount(page);
    expect(after).toBe(before - 1);
    await page.goto(`/teacher/students?query=${encodeURIComponent(email)}&statistics=excluded`);
    const row = page.getByRole("table", { name: "학생 목록" }).locator("tr").filter({
      has: page.getByText(email, { exact: true }),
    });
    await expect(row).toBeVisible();
    await expect(row.getByText("통계 제외", { exact: true })).toBeVisible();
    return {
      before,
      after,
      restore: async () => {
        const restoreContext = await browser.newContext();
        try {
          await authenticateAs(restoreContext, "fullSystemTeacher");
          const restorePage = await restoreContext.newPage();
          await editStudentStatistics(restorePage, email, true);
        } finally {
          await restoreContext.close();
        }
      },
    };
  } finally {
    await context.close();
  }
}

export async function createWeeklyEvent(browser: Browser, title: string): Promise<void> {
  const context = await browser.newContext();
  try {
    await authenticateAs(context, "fullSystemTeacher");
    const page = await context.newPage();
    await page.goto("/teacher/events");
    const date = seoulCalendarDate();
    await page.getByLabel("제목", { exact: true }).fill(title);
    await page.getByLabel("시작", { exact: true }).fill(`${date}T09:00`);
    await page.getByLabel("종료", { exact: true }).fill(`${date}T10:00`);
    await page.getByLabel("매주 반복", { exact: true }).check();
    const eventResponse = page.waitForResponse((response) => (
      response.url().includes("/api/teacher/events")
      && response.request().method() === "POST"
    ));
    await page.getByRole("button", { name: "일정 저장" }).click();
    expect((await eventResponse).status()).toBe(201);
    await expect(page.getByRole("status").filter({ hasText: "일정을 등록했습니다." })).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
}

export async function revokeKiosk(browser: Browser, kioskPage: Page): Promise<void> {
  const state = kioskJourney.get(kioskPage);
  if (!state) throw new Error("The shared device must be unlocked before revocation.");
  const context = await browser.newContext();
  try {
    await authenticateAs(context, "fullSystemTeacher");
    const page = await context.newPage();
    await page.goto("/admin/kiosks");
    const session = page.getByRole("listitem").filter({
      has: page.getByText(state.sessionId, { exact: true }),
    });
    await expect(session).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    const revokeResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/admin/kiosk-sessions/${state.sessionId}`)
      && response.request().method() === "DELETE"
    ));
    await session.getByRole("button", { name: "세션 해지" }).click();
    expect((await revokeResponse).status()).toBe(204);
    await expect(page.getByRole("status").filter({ hasText: "기기 세션을 해지했습니다." })).toBeVisible();
  } finally {
    await context.close();
  }
  await expect(kioskPage.getByLabel("관리자 비밀번호")).toBeVisible({ timeout: 30_000 });
}
