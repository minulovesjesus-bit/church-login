import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import HomePage from "./page";

it("offers student and teacher entry points", () => {
  render(<HomePage />);

  expect(
    screen.getByRole("heading", { name: "함께하는 오늘, 안심되는 출결" }),
  ).toBeVisible();
  expect(
    screen.getByText("학생과 교사가 한곳에서 출결과 일정을 확인해요."),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "학생으로 로그인" })).toHaveAttribute(
    "href",
    "/auth/login",
  );
  expect(screen.getByRole("link", { name: "교사로 로그인" })).toHaveAttribute(
    "href",
    "/teacher/login",
  );
  expect(screen.getByRole("link", { name: "학생 회원가입" })).toHaveAttribute(
    "href",
    "/auth/signup",
  );
  expect(screen.getByRole("img", { name: "햇살이 비치는 열린 교회 문" })).not.toHaveAttribute(
    "loading",
  );
});
