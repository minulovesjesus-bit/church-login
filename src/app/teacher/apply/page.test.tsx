import { expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import TeacherApplicationPage from "./page";

it("redirects the retired teacher application route to unified continuation", () => {
  TeacherApplicationPage();

  expect(redirect).toHaveBeenCalledWith("/auth/continue");
});
