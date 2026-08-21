import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import HomePage from "./page";

it("offers student and teacher entry points", () => {
  render(<HomePage />);

  expect(screen.getByRole("link", { name: "학생으로 로그인" })).toHaveAttribute(
    "href",
    "/auth/login",
  );
  expect(screen.getByRole("link", { name: "교사로 로그인" })).toHaveAttribute(
    "href",
    "/teacher/login",
  );
});
