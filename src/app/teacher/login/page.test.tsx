import { expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import TeacherLoginPage from "./page";


it("redirects the legacy teacher login route to unified login", () => {
  TeacherLoginPage();

  expect(redirect).toHaveBeenCalledWith("/login");
});
