import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <svg>{children}</svg>,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Bar: ({ fill }: { fill: string }) => <rect aria-label="입실 막대 색상" fill={fill} />,
}));

import StayChart from "./stay-chart";

it("uses the primary semantic token without changing the accessible chart label", () => {
  render(<StayChart entries={[{ hour: 9, entries: 4 }]} />);

  expect(screen.getByRole("img", { name: "시간대별 입실 차트" })).toBeInTheDocument();
  expect(screen.getByLabelText("입실 막대 색상")).toHaveAttribute("fill", "var(--primary)");
});

it("keeps the chart's accessible empty-state copy", () => {
  render(<StayChart entries={[]} />);

  expect(screen.getByText("선택한 기간의 입실 시간대 데이터가 없어요.")).toBeInTheDocument();
});
