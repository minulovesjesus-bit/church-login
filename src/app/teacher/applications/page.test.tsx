import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const ApiClientError = vi.hoisted(() => class extends Error {});

vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError }));

import TeacherApplicationsPage from "./page";

const application = {
  id: "8d793e62-da07-4d0c-9d19-f9b50dc7b585",
  user_id: "f272cb70-a2c2-4a49-94a1-309427635571",
  email: "teacher@example.com",
  name: "김교사",
  phone: "01011112222",
  status: "pending" as const,
};

afterEach(() => {
  vi.restoreAllMocks();
});

it("shows loading until the pending application request settles", async () => {
  let resolveApplications: ((applications: typeof application[]) => void) | undefined;
  mockApi.get.mockReturnValue(new Promise((resolve) => {
    resolveApplications = resolve;
  }));

  render(<TeacherApplicationsPage />);

  expect(screen.getByRole("status")).toHaveTextContent("신청 목록을 불러오고 있습니다.");
  expect(screen.queryByText("대기 중인 신청이 없습니다.")).not.toBeInTheDocument();

  resolveApplications?.([]);
  expect(await screen.findByText("대기 중인 신청이 없습니다.")).toBeInTheDocument();
});

it("renders an accessible error when approval fails", async () => {
  mockApi.get.mockResolvedValue([application]);
  mockApi.post.mockRejectedValue(new ApiClientError("승인 실패"));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<TeacherApplicationsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "승인" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("승인 실패");
  expect(screen.getByText("김교사")).toBeInTheDocument();
});

it("renders an accessible error when rejection fails", async () => {
  mockApi.get.mockResolvedValue([application]);
  mockApi.post.mockRejectedValue(new ApiClientError("거절 실패"));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "prompt").mockReturnValue("정보 확인 필요");
  render(<TeacherApplicationsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "거절" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("거절 실패");
  expect(screen.getByText("김교사")).toBeInTheDocument();
});
