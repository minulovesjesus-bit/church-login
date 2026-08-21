import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/api/client", () => ({ api: mockApi }));

import TeacherPage from "./page";

afterEach(() => {
  replace.mockReset();
});

it("redirects a user without current teacher capability to the application page", async () => {
  mockApi.get.mockResolvedValue({ capabilities: { teacher: false } });

  render(<TeacherPage />);

  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/teacher/apply"));
  expect(screen.queryByRole("heading", { name: "교사 대시보드" })).not.toBeInTheDocument();
});

it("renders the teacher dashboard only after FastAPI grants teacher capability", async () => {
  mockApi.get.mockResolvedValue({ capabilities: { teacher: true } });

  render(<TeacherPage />);

  expect(await screen.findByRole("heading", { name: "교사 대시보드" })).toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
});
