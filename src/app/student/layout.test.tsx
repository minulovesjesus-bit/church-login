import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/student" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import StudentLayout from "./layout";

it("uses one semantic responsive navigation path with only implemented destinations", () => {
  navigation.pathname = "/student";
  render(<StudentLayout><p>학생 내용</p></StudentLayout>);

  const nav = screen.getByRole("navigation", { name: "학생 메뉴" });
  expect(screen.getAllByRole("navigation", { name: "학생 메뉴" })).toHaveLength(1);
  expect(within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["홈", "/student"],
    ["QR 출결", "/student/scan"],
    ["출결 기록", "/student/attendance"],
    ["일정", "/student/events"],
  ]);
  expect(within(nav).getByRole("link", { name: "홈" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).queryByRole("link", { name: /프로필/ })).not.toBeInTheDocument();

  for (const link of within(nav).getAllByRole("link")) {
    expect(link.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    expect(link.querySelector("span")).toHaveTextContent(link.textContent ?? "");
  }

  expect(nav.closest(".student-shell")).not.toBeNull();
  expect(nav.closest(".student-shell")?.querySelector(".student-shell-content")).toContainElement(
    screen.getByText("학생 내용"),
  );
});

it("keeps the scanner as the shell's direct full-bleed child", () => {
  const { container } = render(
    <StudentLayout><section className="student-scan-shell">스캐너</section></StudentLayout>,
  );

  expect(container.querySelector(".student-shell-content > .student-scan-shell")).toBe(
    screen.getByText("스캐너"),
  );

  const shellStyles = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
  expect(shellStyles).toMatch(
    /\.student-shell-content:has\(> \.student-scan-shell\)\s*\{\s*padding-bottom:\s*0;/,
  );
  expect(shellStyles).toMatch(
    /@media \(min-width: 64rem\)[\s\S]*?\.student-shell-content:has\(> \.student-scan-shell\)\s*\{\s*padding-top:\s*0;/,
  );
});
