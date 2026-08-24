import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import HomePage from "./page";

it("offers one unified login entry point", () => {
  render(<HomePage />);

  expect(
    screen.getByRole("heading", { name: "함께하는 오늘, 안심되는 출결" }),
  ).toBeVisible();
  expect(
    screen.getByText("학생과 교사가 한곳에서 출결과 일정을 확인해요."),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "로그인하기" })).toHaveAttribute(
    "href",
    "/login",
  );
  expect(screen.queryByText("교사로 로그인")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "학생 회원가입" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "햇살이 비치는 열린 교회 문" })).not.toHaveAttribute(
    "loading",
  );
});
