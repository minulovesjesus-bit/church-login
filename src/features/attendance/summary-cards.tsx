export type SummaryCardItem = {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "active";
};

export function SummaryCards({ items }: { items: SummaryCardItem[] }) {
  return (
    <dl className="attendance-summary-grid" aria-label="출결 요약">
      {items.map((item) => (
        <div
          className={`attendance-summary-card${item.tone === "active" ? " attendance-summary-card--active" : ""}`}
          key={item.label}
        >
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.detail ? <p>{item.detail}</p> : null}
        </div>
      ))}
    </dl>
  );
}
