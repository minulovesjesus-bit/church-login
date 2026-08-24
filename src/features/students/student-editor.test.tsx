import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import StudentEditor from "./student-editor";
import type { TeacherStudent } from "./student-table";

const student = (staff_role: "teacher" | "admin" | null): TeacherStudent => ({
  user_id: "00000000-0000-4000-8000-000000000401",
  email: "student@example.test",
  name: "김학생",
  birth_date: "2012-04-03",
  phone: "01012345678",
  guardian_phone: "01098765432",
  include_in_statistics: true,
  staff_role,
});

function editorProps(overrides: Record<string, unknown> = {}) {
  return {
    student: student(null),
    canPromote: false,
    promoting: false,
    onSave: vi.fn(),
    onPromote: vi.fn().mockResolvedValue(false),
    onCancel: vi.fn(),
    ...overrides,
  };
}

it("shows staff accounts as read-only role badges instead of a promotion action", () => {
  const teacherView = render(<StudentEditor {...editorProps({ student: student("teacher") })} />);
  expect(screen.getByText("교사")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "교사로 승격" })).not.toBeInTheDocument();
  teacherView.unmount();

  render(<StudentEditor {...editorProps({ student: student("admin") })} />);
  expect(screen.getByText("관리자")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "교사로 승격" })).not.toBeInTheDocument();
});
