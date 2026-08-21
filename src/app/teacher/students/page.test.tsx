import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  search: "",
  pathname: "/teacher/students",
  push: vi.fn(),
  replace: vi.fn(),
}));
const client = vi.hoisted(() => {
  class TestApiClientError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    ApiClientError: TestApiClientError,
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/lib/api/client", () => client);

import TeacherStudentsPage, {
  TeacherStudentsManager,
  calculateInternationalAge,
} from "./page";

const student = (overrides: Record<string, unknown> = {}) => ({
  user_id: "00000000-0000-4000-8000-000000000401",
  email: "student@example.test",
  name: "김학생",
  birth_date: "2012-04-03",
  phone: "01012345678",
  guardian_phone: "01098765432",
  include_in_statistics: true,
  ...overrides,
});

const page = (items = [student()], next_cursor: string | null = null) => ({
  items,
  next_cursor,
  page_size: 50,
});

afterEach(() => {
  Object.values(client.api).forEach((mock) => mock.mockReset());
  navigation.search = "";
  navigation.push.mockReset();
  navigation.replace.mockReset();
});

it("renders equivalent semantic desktop rows and mobile cards without student numbers or UUID text", async () => {
  client.api.get.mockResolvedValue(page());
  render(<TeacherStudentsPage />);

  expect(screen.getByRole("status")).toHaveTextContent("학생 목록을 불러오고 있습니다.");
  const table = await screen.findByRole("table", { name: "학생 목록" });
  const cards = screen.getByRole("list", { name: "모바일 학생 목록" });
  for (const region of [table, cards]) {
    expect(within(region).getByText("김학생")).toBeInTheDocument();
    expect(within(region).getByText("만 14세")).toBeInTheDocument();
    expect(within(region).getByText("01012345678")).toBeInTheDocument();
    expect(within(region).getByText("01098765432")).toBeInTheDocument();
    expect(within(region).getByText("통계 포함")).toBeInTheDocument();
  }
  expect(screen.queryByText(/00000000-0000-4000/)).not.toBeInTheDocument();
  expect(screen.queryByText("학생번호")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "학생 추가" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /삭제|비활성|로그인 차단/ })).not.toBeInTheDocument();
  expect(client.api.get).toHaveBeenCalledWith(
    "/api/teacher/students?statistics=all&page_size=50",
  );
});

it("calculates Seoul-date international age immediately before and on the birthday", () => {
  expect(calculateInternationalAge("2012-04-03", "2026-04-02")).toBe(13);
  expect(calculateInternationalAge("2012-04-03", "2026-04-03")).toBe(14);
  expect(calculateInternationalAge("2012-04-03", "2026-04-04")).toBe(14);
});

it("normalizes URL state, preserves valid filters and cursor, then clears cursor on new filters", async () => {
  navigation.search = "query=%20%20%EA%B9%80%20%20%ED%95%99%EC%83%9D%20%20&statistics=excluded&cursor=opaque-cursor";
  client.api.get.mockResolvedValue(page([]));
  render(<TeacherStudentsPage />);

  await screen.findByText("조건에 맞는 학생이 없습니다.");
  expect(client.api.get).toHaveBeenCalledWith(
    "/api/teacher/students?query=%EA%B9%80+%ED%95%99%EC%83%9D&statistics=excluded&cursor=opaque-cursor&page_size=50",
  );
  expect(screen.getByLabelText("학생 검색")).toHaveValue("김 학생");
  expect(screen.getByLabelText("통계 상태")).toHaveValue("excluded");

  fireEvent.change(screen.getByLabelText("학생 검색"), { target: { value: "  이   학생  " } });
  fireEvent.change(screen.getByLabelText("통계 상태"), { target: { value: "included" } });
  fireEvent.submit(screen.getByRole("form", { name: "학생 검색 및 필터" }));
  expect(navigation.push).toHaveBeenCalledWith(
    "/teacher/students?query=%EC%9D%B4+%ED%95%99%EC%83%9D&statistics=included",
  );
  expect(navigation.push.mock.calls[0][0]).not.toContain("cursor");
});

it("normalizes duplicate and invalid URL values to safe defaults", async () => {
  navigation.search = "query=a&query=b&statistics=invalid&cursor=one&cursor=two";
  client.api.get.mockResolvedValue(page([]));
  render(<TeacherStudentsPage />);

  await screen.findByText("조건에 맞는 학생이 없습니다.");
  expect(client.api.get).toHaveBeenCalledWith(
    "/api/teacher/students?statistics=all&page_size=50",
  );
  expect(navigation.replace).toHaveBeenCalledWith("/teacher/students?statistics=all");
});

it("renders retryable error and empty states", async () => {
  client.api.get
    .mockRejectedValueOnce(new client.ApiClientError("REQUEST_FAILED", "학생 목록을 불러오지 못했습니다."))
    .mockResolvedValueOnce(page([]));
  render(<TeacherStudentsPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("학생 목록을 불러오지 못했습니다.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByText("조건에 맞는 학생이 없습니다.")).toBeInTheDocument();
});

it.each([
  ["AUTH_REQUIRED", "/teacher/login"],
  ["FORBIDDEN", "/teacher/apply"],
])("redirects %s and keeps terminal auth ahead of old responses", async (code, destination) => {
  let resolveOld: (value: ReturnType<typeof page>) => void = () => undefined;
  client.api.get
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockRejectedValueOnce(new client.ApiClientError(code, "접근할 수 없습니다."));
  const view = render(<TeacherStudentsManager initialSearch="" />);
  await vi.waitFor(() => expect(client.api.get).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(destination));

  await act(async () => {
    resolveOld(page([student({ name: "늦게 온 학생" })]));
    await Promise.resolve();
  });
  expect(screen.queryByText("늦게 온 학생")).not.toBeInTheDocument();
  view.unmount();
});

it("ignores stale list responses and completions after unmount", async () => {
  let resolveFirst: (value: ReturnType<typeof page>) => void = () => undefined;
  let resolveSecond: (value: ReturnType<typeof page>) => void = () => undefined;
  client.api.get
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
  const view = render(<TeacherStudentsPage />);
  await vi.waitFor(() => expect(client.api.get).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
  await vi.waitFor(() => expect(client.api.get).toHaveBeenCalledTimes(2));
  await act(async () => {
    resolveSecond(page([student({ name: "최신 학생" })]));
    await Promise.resolve();
  });
  expect(await screen.findAllByText("최신 학생")).toHaveLength(2);
  await act(async () => {
    resolveFirst(page([student({ name: "오래된 학생" })]));
    await Promise.resolve();
  });
  expect(screen.queryByText("오래된 학생")).not.toBeInTheDocument();
  view.unmount();
});

it("uses an opaque next cursor without inventing totals", async () => {
  client.api.get
    .mockResolvedValueOnce(page([student()], "next opaque/+="))
    .mockResolvedValueOnce(page([student({ name: "다음 학생" })]));
  render(<TeacherStudentsPage />);
  await screen.findAllByText("김학생");
  expect(screen.queryByText(/총 \d+|\d+ \/ \d+ 페이지/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다음 학생" }));
  expect(navigation.push).toHaveBeenCalledWith(
    "/teacher/students?statistics=all&cursor=next+opaque%2F%2B%3D",
  );
});

it("prefills an editor, validates inline, and sends only a normalized complete PATCH", async () => {
  client.api.get
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(page([student({
      name: "수정 학생",
      phone: "01022223333",
      guardian_phone: "01044445555",
      include_in_statistics: false,
    })]));
  client.api.patch.mockResolvedValue(student({ include_in_statistics: false }));
  render(<TeacherStudentsPage />);
  await screen.findAllByText("김학생");
  fireEvent.click(screen.getAllByRole("button", { name: "김학생 수정" })[0]);

  expect(screen.getByLabelText("계정 이메일")).toHaveValue("student@example.test");
  expect(screen.getByLabelText("계정 이메일")).toHaveAttribute("readonly");
  expect(screen.getByLabelText("이름")).toHaveValue("김학생");
  expect(screen.getByText(/교사 전체 집계 통계에서만 제외/)).toBeInTheDocument();
  expect(screen.getByText(/로그인과 QR 출결은 계속 이용/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "학생 정보 저장" }));
  expect(await screen.findByText("이름을 입력해 주세요.")).toBeInTheDocument();
  expect(client.api.patch).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "  수정   학생 " } });
  fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "010-2222-3333" } });
  fireEvent.change(screen.getByLabelText("보호자 연락처"), { target: { value: "010 4444 5555" } });
  fireEvent.click(screen.getByLabelText("통계 제외"));
  fireEvent.click(screen.getByRole("button", { name: "학생 정보 저장" }));

  await vi.waitFor(() => expect(client.api.patch).toHaveBeenCalledWith(
    "/api/teacher/students/00000000-0000-4000-8000-000000000401",
    {
      name: "수정 학생",
      birth_date: "2012-04-03",
      phone: "01022223333",
      guardian_phone: "01044445555",
      include_in_statistics: false,
    },
  ));
  expect(await screen.findAllByText("수정 학생")).toHaveLength(2);
  expect(screen.getByRole("status")).toHaveTextContent("학생 정보를 수정했습니다.");
});

it("preserves editor and rows on failure and prevents duplicate saves or competing edits", async () => {
  let rejectSave: (error: Error) => void = () => undefined;
  client.api.get.mockResolvedValue(page([
    student(),
    student({ user_id: "00000000-0000-4000-8000-000000000402", name: "이학생" }),
  ]));
  client.api.patch.mockImplementation(() => new Promise((_, reject) => { rejectSave = reject; }));
  render(<TeacherStudentsPage />);
  await screen.findAllByText("김학생");
  fireEvent.click(screen.getAllByRole("button", { name: "김학생 수정" })[0]);
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "실패 보존 이름" } });
  const saveButton = screen.getByRole("button", { name: "학생 정보 저장" });
  fireEvent.click(saveButton);
  fireEvent.click(saveButton);
  expect(client.api.patch).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("button", { name: "이학생 수정" })[0]).toBeDisabled();
  fireEvent.click(screen.getAllByRole("button", { name: "이학생 수정" })[0]);
  expect(screen.getByLabelText("이름")).toHaveValue("실패 보존 이름");

  await act(async () => {
    rejectSave(new client.ApiClientError("REQUEST_FAILED", "수정하지 못했습니다."));
    await Promise.resolve();
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("수정하지 못했습니다.");
  expect(screen.getByLabelText("이름")).toHaveValue("실패 보존 이름");
  expect(screen.getAllByText("김학생")).toHaveLength(2);
});

it("refreshes the filtered cursor page so an excluded student disappears after a successful toggle", async () => {
  navigation.search = "statistics=included&cursor=current-cursor";
  client.api.get
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(page([]));
  client.api.patch.mockResolvedValue(student({ include_in_statistics: false }));
  render(<TeacherStudentsPage />);
  await screen.findAllByText("김학생");
  fireEvent.click(screen.getAllByRole("button", { name: "김학생 수정" })[0]);
  fireEvent.click(screen.getByLabelText("통계 제외"));
  fireEvent.click(screen.getByRole("button", { name: "학생 정보 저장" }));

  expect(await screen.findByText("조건에 맞는 학생이 없습니다.")).toBeInTheDocument();
  expect(client.api.get).toHaveBeenLastCalledWith(
    "/api/teacher/students?statistics=included&cursor=current-cursor&page_size=50",
  );
  expect(screen.queryByText("김학생")).not.toBeInTheDocument();
});
