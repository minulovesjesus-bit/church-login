import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const client = vi.hoisted(() => {
  class TestApiClientError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { api: { get: vi.fn() }, ApiClientError: TestApiClientError };
});

vi.mock("@/lib/api/client", () => client);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import StudentPage from "./page";

afterEach(() => {
  router.replace.mockReset();
  client.api.get.mockReset();
});

it("redirects a new student to onboarding", async () => {
  client.api.get.mockResolvedValue({ onboarding_completed: false, capabilities: { student: false } });
  render(<StudentPage />);

  await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
});

it("shows the student home for a returning student", async () => {
  client.api.get.mockResolvedValue({ onboarding_completed: true, capabilities: { student: true } });
  render(<StudentPage />);

  expect(await screen.findByRole("heading", { name: "학생 출결" })).toBeInTheDocument();
  expect(router.replace).not.toHaveBeenCalled();
});

it("redirects to login only when authentication is required", async () => {
  client.api.get.mockRejectedValue(new client.ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  render(<StudentPage />);

  await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/auth/login"));
});

it("shows a retryable error for a temporary API failure", async () => {
  client.api.get.mockRejectedValue(new client.ApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."));
  render(<StudentPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  expect(router.replace).not.toHaveBeenCalled();
});

it("retries a temporary API failure", async () => {
  client.api.get
    .mockRejectedValueOnce(new client.ApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."))
    .mockResolvedValueOnce({ onboarding_completed: true, capabilities: { student: true } });
  render(<StudentPage />);

  fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));

  expect(await screen.findByRole("heading", { name: "학생 출결" })).toBeInTheDocument();
});
