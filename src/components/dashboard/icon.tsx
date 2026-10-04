import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  inbox:
    "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-9.5A8.5 8.5 0 0 1 10.5 4H13a8 8 0 0 1 8 7.5Z M7 10h10 M7 14h6",
  products: "m12 3 9 5v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9 M7 5l10 6",
  orders: "M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4",
  customers:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  agents:
    "M8 4h8 M12 1v3 M5 7h14v13H5z M2 11h3 M19 11h3 M9 11v2 M15 11v2 M9 17h6",
  knowledge:
    "M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Z M12 5v15",
  instagram:
    "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 6h.01",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  workflows: "M3 3h6v6H3z M15 15h6v6h-6z M9 6h9v9 M6 9v9h9",
  businesses:
    "M4 21V5l10-2v18 M14 9h6v12 M8 7v2 M8 12v2 M8 17v2 M17 12v2 M17 17v2 M2 21h20",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z",
  sun: "M12 4v2M12 18v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M4 12H2M22 12h-2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  moon: "M21 14.5A8.5 8.5 0 1 1 9.5 3 6.5 6.5 0 0 0 21 14.5z",
  display: "M4 5h16v10H4zM8 19h8M12 15v4",
  calendar: "M5 5h14v16H5z M8 2v6 M16 2v6 M5 11h14",
};
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name] ?? paths.spark} />
    </svg>
  );
}
