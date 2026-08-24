import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { StudentProfileForm } from "@/features/student-account/student-profile-form";
import type { StudentProfile } from "@/features/student-account/types";

const profile: StudentProfile = {
  name: "김민준",
  birth_date: "2012-04-03",
  phone: "01012345678",
  guardian_phone: "01098765432",
  include_in_statistics: true,
};

function renderForm({
  pending = false,
  error,
  onCancel = vi.fn(),
  onSubmit = vi.fn(),
}: {
  pending?: boolean;
  error?: string;
  onCancel?: () => void;
  onSubmit?: (nextProfile: Omit<StudentProfile, "include_in_statistics">) => void;
} = {}) {
  return {
    onCancel,
    onSubmit,
    ...render(
      <StudentProfileForm
        email="student@example.com"
        profile={profile}
        pending={pending}
        error={error}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    ),
  };
}

it("prefills every editable segment and keeps email read-only without a submitted name", () => {
  renderForm();

  expect(screen.getByLabelText("이메일")).toHaveValue("student@example.com");
  expect(screen.getByLabelText("이메일")).toHaveAttribute("readonly");
  expect(screen.getByLabelText("이메일")).not.toHaveAttribute("name");
  expect(screen.getByLabelText("이름")).toHaveValue("김민준");
  expect(screen.getByLabelText("생년")).toHaveValue("2012");
  expect(screen.getByLabelText("월")).toHaveValue("04");
  expect(screen.getByLabelText("일")).toHaveValue("03");
  expect(screen.getByLabelText("학생 연락처 앞자리")).toHaveValue("010");
  expect(screen.getByLabelText("학생 연락처 중간자리")).toHaveValue("1234");
  expect(screen.getByLabelText("학생 연락처 끝자리")).toHaveValue("5678");
  expect(screen.getByLabelText("보호자 연락처 앞자리")).toHaveValue("010");
  expect(screen.getByLabelText("보호자 연락처 중간자리")).toHaveValue("9876");
  expect(screen.getByLabelText("보호자 연락처 끝자리")).toHaveValue("5432");
});

it("submits exactly the editable, normalized profile values", () => {
  const onSubmit = vi.fn();
  renderForm({ onSubmit });

  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "  김민준  " } });
  fireEvent.change(screen.getByLabelText("학생 연락처 중간자리"), {
    target: { value: "12a34" },
  });
  fireEvent.change(screen.getByLabelText("보호자 연락처 끝자리"), {
    target: { value: "54x32" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "저장" }).closest("form")!);

  expect(onSubmit).toHaveBeenCalledWith({
    name: "김민준",
    birth_date: "2012-04-03",
    phone: "01012345678",
    guardian_phone: "01098765432",
  });
});

it("exposes no form control or submitted field for account-only data", () => {
  renderForm();

  const form = screen.getByRole("button", { name: "저장" }).closest("form")!;
  expect([...new FormData(form).keys()]).toEqual([
    "name",
    "birth_date",
    "phone",
    "guardian_phone",
  ]);
  expect(form.querySelector('[name="include_in_statistics"]')).toBeNull();
  expect(form.querySelector('[name="role"]')).toBeNull();
  expect(form.querySelector('[name="user_id"]')).toBeNull();
  expect(form.querySelector('[name="email"]')).toBeNull();
});

it("keeps edits and visible errors while pending disables duplicate actions", () => {
  const onSubmit = vi.fn();
  const { rerender } = renderForm({ onSubmit });

  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "김민지" } });
  fireEvent.change(screen.getByLabelText("학생 연락처 끝자리"), { target: { value: "4567" } });
  rerender(
    <StudentProfileForm
      email="student@example.com"
      profile={profile}
      pending
      error="저장하지 못했습니다."
      onCancel={vi.fn()}
      onSubmit={onSubmit}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent("저장하지 못했습니다.");
  expect(screen.getByLabelText("이름")).toHaveValue("김민지");
  expect(screen.getByLabelText("학생 연락처 끝자리")).toHaveValue("4567");
  expect(screen.getByLabelText("이름")).toBeDisabled();
  expect(screen.getByLabelText("생년")).toBeDisabled();
  expect(screen.getByLabelText("학생 연락처 앞자리")).toBeDisabled();
  expect(screen.getByRole("button", { name: /저장 중/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();

  fireEvent.submit(screen.getByRole("button", { name: /저장 중/ }).closest("form")!);
  expect(onSubmit).not.toHaveBeenCalled();
});
