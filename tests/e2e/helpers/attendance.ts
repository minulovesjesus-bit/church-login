import { execFileSync } from "node:child_process";

import { expect, type Page } from "@playwright/test";

const renderedTokens = new WeakMap<Page, string>();

async function qrResponseToken(page: Page, previous?: string): Promise<string> {
  const response = await page.waitForResponse(async (candidate) => {
    if (!candidate.url().includes("/api/kiosk/qr") || candidate.request().method() !== "GET" || !candidate.ok()) return false;
    if (!previous) return true;
    const body = await candidate.json().catch(() => null) as { token?: string } | null;
    return Boolean(body?.token && body.token !== previous);
  }, { timeout: 25_000 });
  const body = await response.json() as { token: string };
  renderedTokens.set(page, body.token);
  return body.token;
}

export async function unlockKiosk(page: Page): Promise<{ token: string; sessionId: string }> {
  await page.goto("/login");
  const sessionResponse = page.waitForResponse((response) => (
    response.url().includes("/api/kiosk/sessions")
    && response.request().method() === "POST"
    && response.status() === 201
  ));
  const nextQr = qrResponseToken(page);
  await page.getByLabel("관리자 비밀번호").fill("Kiosk-e2e-2026!");
  await page.getByRole("button", { name: "QR 화면 열기" }).click();
  const [session, token] = await Promise.all([sessionResponse, nextQr]);
  const body = await session.json() as { session_id: string };
  await expect(page.getByRole("img", { name: "학생 출결용 QR 코드" })).toBeVisible();
  return { token, sessionId: body.session_id };
}

export async function readRenderedQrToken(page: Page): Promise<string> {
  await expect(page.getByRole("img", { name: "학생 출결용 QR 코드" })).toBeVisible();
  const token = renderedTokens.get(page);
  if (!token) throw new Error("No rendered kiosk QR response has been observed.");
  return token;
}

export async function waitForFreshRenderedQrToken(page: Page, previous: string): Promise<string> {
  const token = await qrResponseToken(page, previous);
  await expect(page.getByRole("img", { name: "학생 출결용 QR 코드" })).toBeVisible();
  return token;
}

export async function submitDecodedQr(
  page: Page,
  token: string,
  requestId: string,
): Promise<void> {
  const scanAgain = page.getByRole("button", { name: "새 QR 스캔" });
  if (await scanAgain.isVisible().catch(() => false)) await scanAgain.click();
  await expect(page.getByText("QR 코드를 화면 안에 맞춰 주세요")).toBeVisible();
  await page.evaluate(({ value, id }) => {
    const originalRandomUuid = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => id,
    });
    window.dispatchEvent(new CustomEvent("attendance:test-qr", { detail: value }));
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: originalRandomUuid,
    });
  }, { value: token, id: requestId });
}

export async function advanceTestClock(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function attendanceAuditActions(): Record<string, number> {
  const output = execFileSync(
    "uv",
    ["run", "python", "tests/e2e/fixtures/attendance_audit.py"],
    { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(output) as Record<string, number>;
}
