import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/lib/api/client", () => ({ api: mockApi }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import OnboardingPage from "./page";

it("submits normalized student profile fields", async () => {
  mockApi.post.mockResolvedValue({});
  render(<OnboardingPage />);

  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "김민준" } });
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "2012-04-03" } });
  fireEvent.change(screen.getByLabelText("학생 연락처"), { target: { value: "010-1234-5678" } });
  fireEvent.change(screen.getByLabelText("보호자 연락처"), { target: { value: "010-9876-5432" } });
  fireEvent.click(screen.getByRole("button", { name: "가입 완료" }));

  await vi.waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
    "/api/students/profile",
    expect.objectContaining({
      name: "김민준",
      phone: "01012345678",
      guardian_phone: "01098765432",
    }),
  ));
  expect(router.push).toHaveBeenCalledWith("/student");
});

it("calculates age from birth date without submitting it", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T12:00:00"));
  try {
    render(<OnboardingPage />);

    fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "2012-04-03" } });

    expect(screen.getByText("만 14세")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
