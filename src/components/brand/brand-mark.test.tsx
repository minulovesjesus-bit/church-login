import { render, screen } from "@testing-library/react";

import { BrandLockup, BrandMark } from "./brand-mark";

it("uses the official Calvary Church logo as the canonical site brand", () => {
  const { rerender } = render(<BrandMark />);
  expect(screen.getByRole("img", { name: "갈보리교회" })).toHaveAttribute(
    "src",
    "/images/calvary-church-logo.svg",
  );

  rerender(<BrandLockup />);
  expect(screen.getByRole("img", { name: "갈보리교회" })).toBeVisible();
  expect(screen.queryByText("교회 출결")).not.toBeInTheDocument();
});

it("renders an explicit white logo tone for dark surfaces", () => {
  const { rerender } = render(<BrandMark />);
  expect(screen.getByRole("img", { name: "갈보리교회" })).toHaveClass(
    "brand-mark--dark",
  );

  rerender(<BrandMark tone="light" />);
  expect(screen.getByRole("img", { name: "갈보리교회" })).toHaveClass(
    "brand-mark--light",
  );
});
