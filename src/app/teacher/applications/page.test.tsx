import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import TeacherApplicationsPage from "./page";

it("redirects the retired teacher application queue to unified continuation", () => {
  render(<TeacherApplicationsPage />);

  expect(redirect).toHaveBeenCalledWith("/auth/continue");
});
