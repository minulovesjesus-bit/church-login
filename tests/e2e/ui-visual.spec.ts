import { execFileSync } from "node:child_process";

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

test.beforeAll(() => {
  execFileSync("uv", ["run", "python", "tests/e2e/fixtures/identity_seed.py", "setup"], {
    env: process.env,
    stdio: "inherit",
  });
});

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
    { path: "/login", heading: "로그인", slug: "student-login" },
    { path: "/auth/signup", heading: "학생 회원가입", slug: "student-signup" },
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

test("authentication tasks keep their primary action visible and aligned at layout cliffs", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/login");
  const desktopHeading = await page.getByRole("heading", { name: "로그인" }).boundingBox();
  expect(desktopHeading).not.toBeNull();
  expect(desktopHeading!.x).toBeGreaterThanOrEqual(32);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/login");
  const mobileShell = page.locator("main.auth-shell:visible");
  const image = await mobileShell.locator(".auth-shell-image").boundingBox();
  const submit = await mobileShell.getByRole("button", { name: "로그인", exact: true }).boundingBox();
  expect(image).not.toBeNull();
  expect(submit).not.toBeNull();
  expect(image!.height).toBeLessThanOrEqual(144);
  expect(submit!.y + submit!.height).toBeLessThanOrEqual(568);
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

test("student shell stays a narrow bottom-navigation canvas at every breakpoint", async ({ browser }) => {
  const identities = [
    { fixture: "completeStudent", items: 4 },
    { fixture: "approvedTeacher", items: 5 },
  ] as const;
  const sizes = [
    viewports.student,
    viewports.tabletPortrait,
    viewports.desktop,
  ] as const;

  for (const { fixture, items } of identities) {
    const context = await browser.newContext();
    await authenticateAs(context, fixture);
    const page = await context.newPage();

    try {
      for (const viewport of sizes) {
        await page.setViewportSize(viewport);
        await page.goto("/student");

        const navigation = page.getByRole("navigation", { name: "학생 메뉴" });
        await expect(navigation).toHaveAttribute("data-items", String(items));
        const layout = await page.evaluate(() => {
          const shell = document.querySelector<HTMLElement>(".student-shell");
          const content = document.querySelector<HTMLElement>(".student-shell-content");
          const navigation = document.querySelector<HTMLElement>(".student-navigation");
          const list = navigation?.querySelector<HTMLElement>("ul");

          if (!shell || !content || !navigation || !list) throw new Error("student shell is incomplete");

          const shellBox = shell.getBoundingClientRect();
          const navigationBox = navigation.getBoundingClientRect();
          const navigationStyle = getComputedStyle(navigation);
          const listStyle = getComputedStyle(list);

          return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            shell: { left: shellBox.left, width: shellBox.width, height: shellBox.height },
            navigation: {
              bottom: navigationBox.bottom,
              left: navigationBox.left,
              position: navigationStyle.position,
              width: navigationBox.width,
              height: navigationBox.height,
            },
            contentPaddingBottom: Number.parseFloat(getComputedStyle(content).paddingBottom),
            gridColumns: listStyle.gridTemplateColumns.split(" ").filter(Boolean).map(Number.parseFloat),
            renderedItems: list.querySelectorAll(":scope > li").length,
          };
        });

        expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
        expect(layout.shell.width).toBeLessThanOrEqual(46 * 16);
        expect(layout.shell.width).toBeCloseTo(Math.min(layout.viewportWidth, 46 * 16), 1);
        expect(layout.shell.left).toBeCloseTo((layout.viewportWidth - layout.shell.width) / 2, 1);
        expect(layout.shell.height).toBeGreaterThanOrEqual(layout.viewportHeight);

        expect(layout.navigation.position).toBe("fixed");
        expect(layout.navigation.width).toBeCloseTo(layout.shell.width, 1);
        expect(layout.navigation.left).toBeCloseTo(layout.shell.left, 1);
        expect(layout.navigation.bottom).toBeCloseTo(layout.viewportHeight, 1);
        expect(layout.navigation.height).toBeGreaterThanOrEqual(4 * 16);
        expect(layout.contentPaddingBottom).toBeGreaterThanOrEqual(layout.navigation.height - 1);

        expect(layout.renderedItems).toBe(items);
        expect(layout.gridColumns).toHaveLength(items);
        for (const columnWidth of layout.gridColumns) {
          expect(columnWidth).toBeCloseTo(layout.navigation.width / items, 1);
        }
      }
    } finally {
      await context.close();
    }
  }
});

test("student scanner reserves the fixed navigation area", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 667 } });
  await authenticateAs(context, "completeStudent");
  const page = await context.newPage();

  try {
    await page.goto("/student/scan");
    await expect(page.getByRole("heading", { name: "QR로 출결하기" })).toBeVisible();
    const layout = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>(".student-shell-content");
      const scanner = document.querySelector<HTMLElement>(".student-scan-shell");
      const navigation = document.querySelector<HTMLElement>(".student-navigation");
      if (!content || !scanner || !navigation) throw new Error("student scanner layout is incomplete");

      return {
        contentPaddingBottom: Number.parseFloat(getComputedStyle(content).paddingBottom),
        navigationHeight: navigation.getBoundingClientRect().height,
        scannerMinHeight: Number.parseFloat(getComputedStyle(scanner).minHeight),
        viewportHeight: window.innerHeight,
      };
    });

    expect(layout.contentPaddingBottom).toBeGreaterThanOrEqual(layout.navigationHeight - 1);
    expect(layout.scannerMinHeight).toBeLessThanOrEqual(
      layout.viewportHeight - layout.navigationHeight + 1,
    );
  } finally {
    await context.close();
  }
});

test("teacher routes match tablet and desktop baselines", async ({ browser }) => {
  const context = await browser.newContext();
  await authenticateAs(context, "approvedTeacher");
  const page = await context.newPage();
  await page.clock.setFixedTime(FIXED_TIME);
  await page.route("**/api/teacher/dashboard", async (route) => {
    const response = await route.fetch();
    const dashboard = await response.json() as Record<string, unknown>;
    await route.fulfill({
      response,
      json: { ...dashboard, as_of_date: "2026-08-22" },
    });
  });
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

test("teacher page headings share one desktop content edge", async ({ browser }) => {
  const context = await browser.newContext({ viewport: viewports.desktop });
  await authenticateAs(context, "approvedTeacher");
  const page = await context.newPage();
  const routes = [
    { path: "/teacher", heading: "교사 대시보드" },
    { path: "/teacher/attendance", heading: "전체 출결 관리" },
    { path: "/teacher/students", heading: "학생 관리" },
    { path: "/teacher/events", heading: "일정 관리" },
  ] as const;

  try {
    const leftEdges: number[] = [];
    for (const route of routes) {
      await page.goto(route.path);
      const box = await page.getByRole("heading", { name: route.heading }).boundingBox();
      expect(box).not.toBeNull();
      leftEdges.push(box!.x);
    }
    expect(Math.max(...leftEdges) - Math.min(...leftEdges)).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});

test("locked and unlocked kiosk match portrait and landscape baselines", async ({ page }) => {
  const sizes = [
    ["tablet-portrait", viewports.tabletPortrait],
    ["kiosk", viewports.kiosk],
  ] as const;

  await page.goto("/qr");
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
  await page.getByLabel("기기 이름").fill("본당 입구");
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

test("current staff overlays trap focus, close with Escape, and restore their opener", async ({ browser }) => {
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

    await admin.goto("/admin/staff");
    const approveOpener = admin.getByRole("button", { name: "승인 교사 님 관리자로 승격" });
    await expect(approveOpener).toBeVisible();
    await expectTrappedAndReturned(
      admin,
      approveOpener,
      admin.getByRole("alertdialog", { name: "승인 교사 님 관리자 승격" }),
    );
  } finally {
    await Promise.all([teacherContext.close(), adminContext.close()]);
  }
});
