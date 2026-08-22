import { render, screen } from "@testing-library/react";

import { BrandLockup, BrandMark } from "./brand-mark";

it("exposes one canonical church attendance brand", () => {
  const { rerender } = render(<BrandMark />);
  expect(screen.getByRole("img", { name: "교회 출결" })).toBeVisible();
  rerender(<BrandLockup />);
  expect(screen.getByText("교회 출결")).toBeVisible();
});
