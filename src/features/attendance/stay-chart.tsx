"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TimeOfDayEntry } from "./types";

export default function StayChart({ entries }: { entries: TimeOfDayEntry[] }) {
  if (entries.length === 0) {
    return <p className="attendance-empty-chart">선택한 기간의 입실 시간대 데이터가 없어요.</p>;
  }
  const data = entries.map((entry) => ({ ...entry, label: `${entry.hour}시` }));
  return (
    <div className="attendance-chart" role="img" aria-label="시간대별 입실 차트">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" />
          <YAxis allowDecimals={false} width={32} />
          <Tooltip formatter={(value) => [`${value}회`, "입실"]} />
          <Bar
            dataKey="entries"
            fill="#176d42"
            isAnimationActive={false}
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
