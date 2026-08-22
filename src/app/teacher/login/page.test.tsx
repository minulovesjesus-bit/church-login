import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import TeacherLoginPage from "./page";


it("starts teacher OAuth through the server-generated intent route", () => {
  render(<TeacherLoginPage />);

  const main = screen.getByRole("main");
  const heading = screen.getByRole("heading", { name: "교사 로그인" });
  const action = screen.getByRole("link", { name: "Google로 교사 가입 계속하기" });

  expect(document.querySelectorAll("main")).toHaveLength(1);
  expect(main).toHaveAttribute("aria-labelledby", heading.id);
  expect(action).toHaveAttribute("href", "/auth/teacher/start");
  expect(screen.getAllByRole("link")).toEqual([action]);
  expect(screen.getByRole("img", { name: "햇살이 비치는 열린 교회 문" })).toHaveAttribute(
    "sizes",
    "(min-width: 1024px) 50vw, 100vw",
  );
});
