import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import TeacherLoginPage from "./page";


it("starts teacher OAuth through the server-generated intent route", () => {
  render(<TeacherLoginPage />);

  expect(
    screen.getByRole("link", { name: "Google로 교사 가입 계속하기" }),
  ).toHaveAttribute("href", "/auth/teacher/start");
});
