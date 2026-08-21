import { expect, test } from "@playwright/test";

import { authenticateAs } from "./fixtures/identity";
import {
  approveTeacherAndPromoteAdmin,
  createVerifiedStudent,
  createWeeklyEvent,
  excludeStudentFromAggregates,
  expectTeacherAttendance,
  revokeKiosk,
  scanKioskQr,
  submitTeacherApplication,
  unlockSharedDevice,
} from "./helpers/system";

test("student, teacher, kiosk, attendance, statistics, and events work together", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);

  const student = await createVerifiedStudent(browser, "student@example.test");
  const applicant = await submitTeacherApplication(browser, "teacher@example.test");
  const teacher = await approveTeacherAndPromoteAdmin(browser, applicant);
  const kiosk = await unlockSharedDevice(browser);
  let restoreAggregates: (() => Promise<void>) | undefined;
  let kioskRevoked = false;

  try {
    await scanKioskQr(student, kiosk);
    await expect(student.getByRole("heading", { name: "입실 처리됐어요" })).toBeVisible();
    await expectTeacherAttendance(browser, "student@example.test", "입실 중");

    const exclusion = await excludeStudentFromAggregates(browser, "student@example.test");
    expect(exclusion.after).toBe(exclusion.before - 1);
    restoreAggregates = exclusion.restore;

    const freshStudentContext = await browser.newContext();
    try {
      await authenticateAs(freshStudentContext, "fullSystemStudent");
      const freshStudent = await freshStudentContext.newPage();
      await freshStudent.goto("/student");
      await expect(freshStudent.getByRole("heading", { name: "오늘 출결 상태" })).toBeVisible();
      await freshStudent.goto("/student/attendance");
      await expect(freshStudent.getByText("이번 주 1일", { exact: true })).toBeVisible();
      await expect(freshStudent.getByText("이번 달 1일", { exact: true })).toBeVisible();
      await expect(freshStudent.getByText("총 입실 1회", { exact: true })).toBeVisible();
      await expect(freshStudent.getByText("현재 입실 중", { exact: true })).toBeVisible();
      const personalHistory = freshStudent.getByRole("region", { name: "최근 출결" });
      await expect(personalHistory.getByText("총 1건", { exact: true })).toBeVisible();
      await expect(
        personalHistory.locator(".attendance-desktop-only").getByText("입실", { exact: true }),
      ).toBeVisible();
    } finally {
      await freshStudentContext.close();
    }

    await scanKioskQr(student, kiosk);
    await scanKioskQr(student, kiosk);
    await scanKioskQr(student, kiosk);

    await student.goto("/student/attendance");
    await expect(student.getByRole("heading", { name: "내 출결 기록" })).toBeVisible();
    await expect(student.getByText("이번 달 출석 일수")).toBeVisible();

    await createWeeklyEvent(browser, "주일예배");
    await student.goto("/student/events");
    await expect(student.getByText("주일예배")).toBeVisible();
    const nextWeekLink = student.getByRole("link", { name: "다음 주" });
    const nextWeekHref = await nextWeekLink.getAttribute("href");
    expect(nextWeekHref).toMatch(/^\/student\/events\?week=\d{4}-\d{2}-\d{2}$/);
    const nextWeek = new URL(nextWeekHref!, "http://127.0.0.1:3216").searchParams.get("week");
    const nextWeekEvents = student.waitForResponse((response) => (
      response.url().includes(`/api/events?from=${nextWeek}&`)
      && response.request().method() === "GET"
    ));
    await nextWeekLink.click();
    const nextWeekResponse = await nextWeekEvents;
    expect(nextWeekResponse.ok()).toBe(true);
    const nextWeekOccurrences = await nextWeekResponse.json() as Array<{
      occurrence_id: string;
      title: string;
    }>;
    expect(nextWeekOccurrences.filter((occurrence) => occurrence.title === "주일예배")).toHaveLength(1);
    await expect(student.getByText("주일예배", { exact: true })).toBeVisible();

    await student.setViewportSize({ width: 375, height: 812 });
    await testInfo.attach("student-375", {
      body: await student.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await kiosk.setViewportSize({ width: 768, height: 1024 });
    await testInfo.attach("kiosk-768", {
      body: await kiosk.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await teacher.setViewportSize({ width: 1365, height: 900 });
    await testInfo.attach("teacher-1365", {
      body: await teacher.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await restoreAggregates();
    restoreAggregates = undefined;
    await revokeKiosk(browser, kiosk);
    kioskRevoked = true;
    await expect(kiosk.getByLabel("관리자 비밀번호")).toBeVisible();
  } finally {
    await restoreAggregates?.().catch(() => undefined);
    if (!kioskRevoked) await revokeKiosk(browser, kiosk).catch(() => undefined);
    await Promise.all([
      student.context().close(),
      applicant.page.context().close(),
      teacher.context().close(),
      kiosk.context().close(),
    ]);
  }
});
