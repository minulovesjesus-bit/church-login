import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api: mockApi,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import OnboardingPage from "./page";

it("submits normalized student profile fields", async () => {
  mockApi.post.mockResolvedValue({});
  render(<OnboardingPage />);

  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "김민준" } });
  fireEvent.change(screen.getByLabelText("생년"), { target: { value: "2012" } });
  fireEvent.change(screen.getByLabelText("월"), { target: { value: "04" } });
  fireEvent.change(screen.getByLabelText("일"), { target: { value: "03" } });
  fireEvent.change(screen.getByLabelText("학생 연락처 앞자리"), { target: { value: "010" } });
  fireEvent.change(screen.getByLabelText("학생 연락처 중간자리"), { target: { value: "1234" } });
  fireEvent.change(screen.getByLabelText("학생 연락처 끝자리"), { target: { value: "5678" } });
  fireEvent.change(screen.getByLabelText("보호자 연락처 앞자리"), { target: { value: "010" } });
  fireEvent.change(screen.getByLabelText("보호자 연락처 중간자리"), { target: { value: "9876" } });
  fireEvent.change(screen.getByLabelText("보호자 연락처 끝자리"), { target: { value: "5432" } });
  fireEvent.click(screen.getByRole("button", { name: "가입 완료" }));

  await vi.waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
    "/api/students/profile",
    expect.objectContaining({
      name: "김민준",
      birth_date: "2012-04-03",
      phone: "01012345678",
      guardian_phone: "01098765432",
    }),
  ));
  expect(router.push).toHaveBeenCalledWith("/student");
});

it("renders birth date in year, month, day order and limits numeric input", () => {
  render(<OnboardingPage />);

  const year = screen.getByLabelText("생년");
  const month = screen.getByLabelText("월");
  const day = screen.getByLabelText("일");

  expect(year.compareDocumentPosition(month) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(month.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(year).toHaveAttribute("maxlength", "4");
  expect(month).toHaveAttribute("maxlength", "2");
  expect(day).toHaveAttribute("maxlength", "2");

  fireEvent.change(year, { target: { value: "20a123" } });
  fireEvent.change(month, { target: { value: "0b4" } });
  fireEvent.change(day, { target: { value: "0c3" } });

  expect(year).toHaveValue("2012");
  expect(month).toHaveValue("04");
  expect(day).toHaveValue("03");
});

it("calculates age from the segmented birth date without submitting it", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T12:00:00"));
  try {
    render(<OnboardingPage />);

    fireEvent.change(screen.getByLabelText("생년"), { target: { value: "2012" } });
    fireEvent.change(screen.getByLabelText("월"), { target: { value: "04" } });
    fireEvent.change(screen.getByLabelText("일"), { target: { value: "03" } });

    expect(screen.getByText("만 14세")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("limits phone numbers to 3-4-4 digits and advances focus", () => {
  render(<OnboardingPage />);

  const first = screen.getByLabelText("학생 연락처 앞자리");
  const middle = screen.getByLabelText("학생 연락처 중간자리");
  const last = screen.getByLabelText("학생 연락처 끝자리");

  expect(first).toHaveAttribute("maxlength", "3");
  expect(middle).toHaveAttribute("maxlength", "4");
  expect(last).toHaveAttribute("maxlength", "4");

  first.focus();
  fireEvent.change(first, { target: { value: "01a0" } });
  expect(first).toHaveValue("010");
  expect(middle).toHaveFocus();

  fireEvent.change(middle, { target: { value: "12345" } });
  expect(middle).toHaveValue("1234");
  expect(last).toHaveFocus();

  fireEvent.change(last, { target: { value: "56789" } });
  expect(last).toHaveValue("5678");
});

it("moves phone focus backward when backspace is pressed on an empty segment", () => {
  render(<OnboardingPage />);

  const first = screen.getByLabelText("학생 연락처 앞자리");
  const middle = screen.getByLabelText("학생 연락처 중간자리");
  middle.focus();
  fireEvent.keyDown(middle, { key: "Backspace" });

  expect(first).toHaveFocus();
});

it("keeps the uncontrolled onboarding phone value in its hidden input", () => {
  render(<OnboardingPage />);

  fireEvent.change(screen.getByLabelText("학생 연락처 앞자리"), { target: { value: "010" } });
  fireEvent.change(screen.getByLabelText("학생 연락처 중간자리"), { target: { value: "1234" } });
  fireEvent.change(screen.getByLabelText("학생 연락처 끝자리"), { target: { value: "5678" } });

  expect(document.querySelector('input[type="hidden"][name="phone"]')).toHaveValue("01012345678");
});

it("locks profile submission and associates an API error with the fields", async () => {
  let reject!: (reason: Error) => void;
  mockApi.post.mockReturnValue(new Promise((_, rejectPromise) => { reject = rejectPromise; }));
  render(<OnboardingPage />);

  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "김민준" } });
  fireEvent.change(screen.getByLabelText("생년"), { target: { value: "2012" } });
  fireEvent.change(screen.getByLabelText("월"), { target: { value: "04" } });
  fireEvent.change(screen.getByLabelText("일"), { target: { value: "03" } });
  fireEvent.change(screen.getByLabelText("학생 연락처 앞자리"), { target: { value: "010" } });
  fireEvent.change(screen.getByLabelText("학생 연락처 중간자리"), { target: { value: "1234" } });
  fireEvent.change(screen.getByLabelText("학생 연락처 끝자리"), { target: { value: "5678" } });
  fireEvent.change(screen.getByLabelText("보호자 연락처 앞자리"), { target: { value: "010" } });
  fireEvent.change(screen.getByLabelText("보호자 연락처 중간자리"), { target: { value: "9876" } });
  fireEvent.change(screen.getByLabelText("보호자 연락처 끝자리"), { target: { value: "5432" } });
  fireEvent.click(screen.getByRole("button", { name: "가입 완료" }));
  fireEvent.click(screen.getByRole("button", { name: "저장 중" }));

  expect(mockApi.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "저장 중" })).toBeDisabled();

  reject(new Error("network"));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("가입을 완료하지 못했습니다.");
  expect(screen.getByLabelText("이름")).toHaveAttribute("aria-describedby", alert.id);
  expect(screen.getByLabelText("이름")).toHaveAttribute("aria-invalid", "true");
});
