import { Card, CardContent } from "@/components/ui/card";

export type SummaryCardItem = {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "active";
};

export function SummaryCards({ items }: { items: SummaryCardItem[] }) {
  return (
    <Card className="attendance-summary-rail">
      <CardContent>
        <dl className="attendance-summary-grid" aria-label="출결 요약" role="group">
          {items.map((item) => (
            <div className="attendance-summary-item" data-tone={item.tone} key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
              {item.detail ? <p>{item.detail}</p> : null}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
