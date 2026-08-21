import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

vi.mock("@/lib/api/client", () => ({ api: mockApi }));

import TeacherApplicationPage from "./page";

it.each([
  ["pending", "교사 가입 승인을 기다리고 있습니다."],
  ["rejected", "신청이 거절되었습니다. 정보를 확인해 다시 신청할 수 있습니다."],
] as const)("renders the %s application state", async (status, message) => {
  mockApi.get.mockResolvedValue({ status, rejection_reason: status === "rejected" ? "확인 필요" : null });

  render(<TeacherApplicationPage />);

  expect(await screen.findByText(message)).toBeInTheDocument();
});

it("renders the approved teacher destination", async () => {
  mockApi.get.mockResolvedValue({ status: "approved", rejection_reason: null });

  render(<TeacherApplicationPage />);

  expect(await screen.findByRole("link", { name: "교사 대시보드로 이동" })).toHaveAttribute(
    "href",
    "/teacher",
  );
});

it.each(["none", "rejected"] as const)(
  "submits a teacher application from the %s state without trusted role fields",
  async (status) => {
    mockApi.get.mockResolvedValue({ status, rejection_reason: status === "rejected" ? "확인 필요" : null });
    mockApi.post.mockResolvedValue({ status: "pending" });
    render(<TeacherApplicationPage />);

    fireEvent.change(await screen.findByLabelText("이름"), { target: { value: " 김교사 " } });
    fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "010-1111-2222" } });
    fireEvent.click(screen.getByRole("button", { name: status === "rejected" ? "다시 신청" : "교사 가입 신청" }));

    await vi.waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith("/api/teacher-applications", {
        name: "김교사",
        phone: "01011112222",
      }),
    );
    expect(await screen.findByText("교사 가입 승인을 기다리고 있습니다.")).toBeInTheDocument();
  },
);
