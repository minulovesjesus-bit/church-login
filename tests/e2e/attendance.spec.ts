import { expect, test } from "@playwright/test";

import {
  advanceTestClock,
  attendanceAuditActions,
  readRenderedQrToken,
  submitDecodedQr,
  unlockKiosk,
  waitForFreshRenderedQrToken,
} from "./helpers/attendance";
import { authenticateAs } from "./fixtures/identity";

const REQUEST_IN = "00000000-0000-4000-8000-000000000801";
const REQUEST_COOLDOWN = "00000000-0000-4000-8000-000000000802";
const REQUEST_OUT = "00000000-0000-4000-8000-000000000803";
const REQUEST_SECOND_IN = "00000000-0000-4000-8000-000000000804";

test("kiosk scans alternate, appear in dashboards, preserve corrections, and stop after admin revocation", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const kioskContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const teacherContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const kiosk = await kioskContext.newPage();
  const student = await studentContext.newPage();
  const teacher = await teacherContext.newPage();

  try {
    await authenticateAs(studentContext, "completeStudent");
    await authenticateAs(teacherContext, "approvedTeacher");
    const adminSession = await authenticateAs(adminContext, "admin");

    const unlocked = await unlockKiosk(kiosk);
    const firstToken = await readRenderedQrToken(kiosk);
    expect(firstToken).toBe(unlocked.token);

    await student.goto("/student/scan");
    await submitDecodedQr(student, firstToken, REQUEST_IN);
    await expect(student.getByRole("heading", { name: "입실 처리됐어요" })).toBeVisible();

    await submitDecodedQr(student, firstToken, REQUEST_COOLDOWN);
    await expect(student.getByRole("heading", { name: "잠시만 기다려 주세요" })).toBeVisible();

    await advanceTestClock(10_100);
    await submitDecodedQr(student, firstToken, REQUEST_OUT);
    await expect(student.getByRole("heading", { name: "퇴실 처리됐어요" })).toBeVisible();

    const freshToken = await waitForFreshRenderedQrToken(kiosk, firstToken);
    await advanceTestClock(1_500);
    await submitDecodedQr(student, freshToken, REQUEST_SECOND_IN);
    await expect(student.getByRole("heading", { name: "입실 처리됐어요" })).toBeVisible();

    await student.goto("/student/attendance");
    await expect(student.getByRole("heading", { name: "내 출결 기록" })).toBeVisible();
    await expect(student.getByText("현재 입실 중")).toBeVisible();
    await expect(student.getByText("총 입실 2회")).toBeVisible();
    await student.setViewportSize({ width: 390, height: 844 });
    await testInfo.attach("student-attendance-mobile", {
      body: await student.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await teacher.goto("/teacher/attendance");
    await expect(teacher.getByRole("heading", { name: "전체 출결 관리" })).toBeVisible();
    await expect(teacher.getByRole("img", { name: "시간대별 입실 차트" })).toBeVisible();
    await testInfo.attach("teacher-attendance-desktop", {
      body: await teacher.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await teacher.setViewportSize({ width: 390, height: 844 });
    await testInfo.attach("teacher-attendance-mobile", {
      body: await teacher.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await teacher.setViewportSize({ width: 1280, height: 720 });
    const studentRow = teacher.locator("tr").filter({ hasText: "완료 학생" }).first();
    await expect(studentRow).toBeVisible();
    await studentRow.getByRole("button", { name: "상세 및 보정" }).click();
    await teacher.getByLabel("보정 사유").fill("E2E 중복 확인");
    await teacher.getByRole("button", { name: "원본 기록 취소" }).click();
    await expect(teacher.getByText(/보정이 저장되었습니다/)).toBeVisible();
    await expect(teacher.getByText("취소된 원본").last()).toBeVisible();

    const revokeResponse = await adminContext.request.delete(
      `http://127.0.0.1:8216/api/admin/kiosk-sessions/${unlocked.sessionId}`,
      { headers: { Authorization: `Bearer ${adminSession.access_token}` } },
    );
    expect(revokeResponse.status()).toBe(204);

    const rejectedQr = await kioskContext.request.get("http://127.0.0.1:8216/api/kiosk/qr");
    expect(rejectedQr.status()).toBe(401);
    expect((await rejectedQr.json()).error.code).toBe("KIOSK_SESSION_REVOKED");

    const actions = attendanceAuditActions();
    expect(actions["attendance.corrected"]).toBeGreaterThanOrEqual(1);
    expect(actions["kiosk.session_revoked"]).toBeGreaterThanOrEqual(1);
  } finally {
    await Promise.all([
      kioskContext.close(),
      studentContext.close(),
      teacherContext.close(),
      adminContext.close(),
    ]);
  }
});
