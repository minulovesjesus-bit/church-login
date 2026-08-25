import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { Button } from "@/components/ui/button";

import { AuthShell } from "./auth-shell";

it("provides the shared labelled auth landmark and responsive image", () => {
  render(
    <AuthShell title="학생 로그인" description="안전하게 출결을 확인해요.">
      <Button>계속하기</Button>
    </AuthShell>,
  );

  const main = screen.getByRole("main");
  const heading = within(main).getByRole("heading", { name: "학생 로그인" });
  expect(document.querySelectorAll("main")).toHaveLength(1);
  expect(main).toHaveAttribute("aria-labelledby", heading.id);
  expect(screen.getByText("안전하게 출결을 확인해요.")).toBeVisible();
  const image = screen.getByRole("img", { name: "햇살이 비치는 열린 교회 문" });
  expect(image).toHaveAttribute("sizes", "(min-width: 1024px) 50vw, 100vw");
  expect(image).toHaveAttribute("loading", "eager");
  expect(screen.getByRole("button", { name: "계속하기" })).toHaveClass("min-h-11");
});
