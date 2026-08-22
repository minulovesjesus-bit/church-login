import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { authenticateAs } from "./fixtures/identity";

const viewports = {
  student: { width: 390, height: 844 },
  tabletPortrait: { width: 768, height: 1024 },
  kiosk: { width: 1024, height: 768 },
  desktop: { width: 1440, height: 900 },
} as const;

const FIXED_TIME = new Date("2026-08-22T03:00:00.000Z");
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "[role=option]",
  "[role=checkbox]",
  "[role=radio]",
].join(",");
const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

async function stabilize(page: Page, fixTime = true): Promise<void> {
  if (fixTime) await page.clock.setFixedTime(FIXED_TIME);
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
      nextjs-portal { display: none !important; }
    `,
  });
  await page.locator("nextjs-portal").evaluateAll((portals) => {
    portals.forEach((portal) => portal.remove());
  });
  const devTools = page.getByRole("button", { name: "Open Next.js Dev Tools" });
  if (await devTools.isVisible().catch(() => false)) {
    await devTools.evaluate((node) => {
      const root = node.getRootNode();
      if (root instanceof ShadowRoot) {
        (root.host as HTMLElement).style.display = "none";
        return;
      }
      let target = node as HTMLElement;
      while (target.parentElement && target.parentElement !== document.body) {
        target = target.parentElement;
      }
      target.style.display = "none";
    });
  }
}

async function expectNoSeriousAxeViolations(page: Page, surface = page.url()): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter(({ impact }) => (
    impact === "serious" || impact === "critical"
  ));
  expect(
    violations,
    [`Accessibility violations on ${surface}`, ...violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)].join("\n"),
  ).toEqual([]);
}

async function expectVisibleControlsAtLeast44px(root: Page | Locator): Promise<void> {
  const failures = await root.locator(INTERACTIVE_SELECTOR).evaluateAll((elements) => (
    elements.flatMap((element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const hidden = style.display === "none"
        || style.visibility === "hidden"
        || box.width === 0
        || box.height === 0
        || node.getAttribute("aria-label") === "Open Next.js Dev Tools"
        || node.closest("[aria-hidden=true], [hidden], [inert], nextjs-portal");
      const type = node instanceof HTMLInputElement ? node.type : "";
      const label = (type === "checkbox" || type === "radio")
        ? node.closest("label") ?? (node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`) : null)
        : null;
      const labelBox = label?.getBoundingClientRect();
      const delegatedToLargeLabel = Boolean(labelBox && labelBox.width >= 44 && labelBox.height >= 44);
      if (hidden || delegatedToLargeLabel || (box.width >= 44 && box.height >= 44)) return [];
      return [{
        name: node.getAttribute("aria-label") || node.textContent?.trim().slice(0, 60) || node.tagName,
        tag: node.tagName.toLowerCase(),
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
      }];
    })
  ));
  expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
}

async function expectStableScreenshot(
  page: Page,
  name: string,
  ready: Locator,
  {
    fixTime = true,
    mask = [],
    settled,
  }: { fixTime?: boolean; mask?: Locator[]; settled?: Locator } = {},
): Promise<void> {
  await expect(ready).toBeVisible();
  if (settled) await expect(settled).toBeVisible();
  await stabilize(page, fixTime);
  await expectVisibleControlsAtLeast44px(page);
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    mask,
    maskColor: "#ffffff",
    scale: "css",
  });
}

async function expectFocusInside(page: Page, overlay: Locator): Promise<void> {
  await expect(overlay).toBeVisible();
  await expect.poll(() => overlay.evaluate((node) => node.contains(document.activeElement))).toBe(true);
}

async function expectTrappedAndReturned(
  page: Page,
  opener: Locator,
  overlay: Locator,
): Promise<void> {
  await opener.focus();
  await opener.click();
  await expectFocusInside(page, overlay);
  await stabilize(page);
  await expectVisibleControlsAtLeast44px(overlay);

  const candidates = overlay.locator(TABBABLE_SELECTOR);
  const tabbables: Locator[] = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible() && await candidate.isEnabled()) tabbables.push(candidate);
  }
  expect(tabbables.length, "the open overlay must expose both focus-trap boundaries").toBeGreaterThan(1);
  const first = tabbables[0];
  const last = tabbables.at(-1)!;

  await last.focus();
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();

  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(opener).toBeFocused();
}

test("root and authentication surfaces match mobile and desktop baselines", async ({ page }) => {
  const routes = [
    { path: "/", heading: "함께하는 오늘, 안심되는 출결", slug: "root" },
    { path: "/auth/login", heading: "학생 로그인", slug: "student-login" },
    { path: "/auth/signup", heading: "학생 회원가입", slug: "student-signup" },
    { path: "/teacher/login", heading: "교사 로그인", slug: "teacher-login" },
  ] as const;
  const sizes = [
    ["student", viewports.student],
    ["desktop", viewports.desktop],
  ] as const;

  for (const [sizeName, viewport] of sizes) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route.path);
      await expectStableScreenshot(
        page,
        `${route.slug}-${sizeName}.png`,
        page.getByRole("heading", { name: route.heading }),
      );
      await expectNoSeriousAxeViolations(page, route.path);
    }
  }
});

test("student routes match phone and tablet baselines", async ({ browser }) => {
  const context = await browser.newContext();
  await authenticateAs(context, "completeStudent");
  const page = await context.newPage();
  const routes = [
    { path: "/student", heading: "반가워요!", slug: "student-home" },
    { path: "/student/scan", heading: "QR로 출결하기", slug: "student-scan" },
    { path: "/student/attendance", heading: "내 출결 기록", slug: "student-attendance" },
    { path: "/student/events", heading: "주간 일정", slug: "student-events" },
  ] as const;
  const sizes = [
    ["student", viewports.student],
    ["tablet-portrait", viewports.tabletPortrait],
  ] as const;

  try {
    for (const [sizeName, viewport] of sizes) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(route.path);
        await expectStableScreenshot(
          page,
          `${route.slug}-${sizeName}.png`,
          page.getByRole("heading", { name: route.heading }),
        );
      }
    }

    await page.setViewportSize(viewports.student);
    await page.goto("/student");
    await expect(page.getByRole("heading", { name: "반가워요!" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  } finally {
    await context.close();
  }
});

test("teacher routes match tablet and desktop baselines", async ({ browser }) => {
  const context = await browser.newContext();
  await authenticateAs(context, "approvedTeacher");
  const page = await context.newPage();
  const routes = [
    { path: "/teacher", heading: "교사 대시보드", slug: "teacher-dashboard" },
    { path: "/teacher/attendance", heading: "전체 출결 관리", slug: "teacher-attendance" },
    { path: "/teacher/students", heading: "학생 관리", slug: "teacher-students" },
    { path: "/teacher/events", heading: "일정 관리", slug: "teacher-events" },
  ] as const;
  const sizes = [
    ["tablet-portrait", viewports.tabletPortrait],
    ["desktop", viewports.desktop],
  ] as const;

  try {
    for (const [sizeName, viewport] of sizes) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(route.path);
        await expectStableScreenshot(
          page,
          `${route.slug}-${sizeName}.png`,
          page.getByRole("heading", { name: route.heading }),
          {
            settled: route.path === "/teacher/attendance"
              ? page.getByRole("img", { name: "시간대별 입실 차트" }).or(
                page.getByText("선택한 기간의 입실 시간대 데이터가 없어요."),
              )
              : undefined,
          },
        );
      }
    }

    await page.setViewportSize(viewports.desktop);
    await page.goto("/teacher");
    await expect(page.getByRole("heading", { name: "교사 대시보드" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  } finally {
    await context.close();
  }
});

test("locked and unlocked kiosk match portrait and landscape baselines", async ({ page }) => {
  const sizes = [
    ["tablet-portrait", viewports.tabletPortrait],
    ["kiosk", viewports.kiosk],
  ] as const;

  await page.goto("/login");
  for (const [sizeName, viewport] of sizes) {
    await page.setViewportSize(viewport);
    await expectStableScreenshot(
      page,
      `kiosk-locked-${sizeName}.png`,
      page.getByRole("heading", { name: "출결 QR 기기" }),
      { fixTime: false },
    );
  }

  const qrResponse = page.waitForResponse((response) => (
    response.url().includes("/api/kiosk/qr")
    && response.request().method() === "GET"
    && response.ok()
  ));
  await page.getByLabel("관리자 비밀번호").fill("Kiosk-e2e-2026!");
  await page.getByRole("button", { name: "QR 화면 열기" }).click();
  const challenge = await (await qrResponse).json() as { issued_at: string };
  await expect(page.getByRole("img", { name: "학생 출결용 QR 코드" })).toBeVisible();
  await page.clock.setFixedTime(new Date(challenge.issued_at));

  for (const [sizeName, viewport] of sizes) {
    await page.setViewportSize(viewport);
    const qr = page.getByRole("img", { name: "학생 출결용 QR 코드" });
    await expectStableScreenshot(
      page,
      `kiosk-unlocked-${sizeName}.png`,
      qr,
      { fixTime: false, mask: [qr] },
    );
  }
  await expectNoSeriousAxeViolations(page);
});

test("Sheet, Dialog, and AlertDialog trap focus, close with Escape, and restore their opener", async ({ browser }) => {
  const teacherContext = await browser.newContext({ viewport: viewports.tabletPortrait });
  const adminContext = await browser.newContext({ viewport: viewports.desktop });
  await authenticateAs(teacherContext, "approvedTeacher");
  await authenticateAs(adminContext, "admin");
  const teacher = await teacherContext.newPage();
  const admin = await adminContext.newPage();

  try {
    await teacher.goto("/teacher");
    const menuOpener = teacher.getByRole("button", { name: "교사 메뉴 열기" });
    await expectTrappedAndReturned(
      teacher,
      menuOpener,
      teacher.getByRole("dialog", { name: "교사 메뉴" }),
    );

    await admin.goto("/teacher/applications");
    const rejectOpener = admin.getByRole("button", { name: "승인 대기 교사 님 거절" });
    await expectTrappedAndReturned(
      admin,
      rejectOpener,
      admin.getByRole("dialog", { name: "승인 대기 교사 님 신청 거절" }),
    );

    const approveOpener = admin.getByRole("button", { name: "승인 대기 교사 님 승인" });
    await expectTrappedAndReturned(
      admin,
      approveOpener,
      admin.getByRole("alertdialog", { name: "승인 대기 교사 님 교사 승인" }),
    );
  } finally {
    await Promise.all([teacherContext.close(), adminContext.close()]);
  }
});
