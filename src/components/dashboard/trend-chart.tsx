import { DataChart } from "@/components/charts/data-chart";
import { shortDate } from "@/lib/reports/model";

/** Compatibility adapter for the existing overview; drawing and interaction live in DataChart. */
export function TrendChart({ data }: { data: { date: string; conversations: number; orders: number }[] }) {
  return <DataChart data={{ title: "Biseda dhe porosi të krijuara në 7 ditët e fundit", kind: "line",
    categories: data.map(d => ({ key: d.date, label: shortDate(d.date.slice(0, 10)) })),
    series: [{ key: "conversations", label: "Biseda", values: data.map(d => d.conversations) },
      { key: "orders", label: "Porosi", values: data.map(d => d.orders) }],
  }} />;
}
