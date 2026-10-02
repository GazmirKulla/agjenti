import Link from "next/link";
import { Icon } from "./icon";
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {children}
    </div>
  );
}
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "purple",
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: string;
  tone?: string;
}) {
  return (
    <div className="panel stat-card">
      <div className="stat-top">
        <span className={`icon-tile tone-${tone}`}>
          <Icon name={icon} size={25} />
        </span>
        <strong>{value}</strong>
      </div>
      <h2>{label}</h2>
      <p>{hint}</p>
    </div>
  );
}
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <span className="icon-tile">
        <Icon name="inbox" size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function SectionTitle({
  title,
  href,
  action = "Shiko të gjitha",
}: {
  title: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {href && (
        <Link href={href}>
          {action}
          <Icon name="arrow" size={16} />
        </Link>
      )}
    </div>
  );
}
const labels: Record<string, string> = {
  active: "Në proces",
  paused: "E pauzuar",
  completed: "E përfunduar",
  draft: "Draft",
  confirmed: "E konfirmuar",
  submitted: "E përcjellë",
  failed: "Dështoi",
  connected: "I lidhur",
  expired: "Ka skaduar",
  revoked: "Qasja u hoq",
  disconnected: "I shkëputur",
  manual: "Manual",
  linked: "I lidhur",
  owner: "Pronar",
  staff: "Staf",
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status}`}>
      {labels[status] ?? status}
    </span>
  );
}
export function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("sq-AL", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/Tirane",
      }).format(new Date(value))
    : "—";
}
export function money(value: number | null, currency = "ALL") {
  return value == null
    ? "—"
    : new Intl.NumberFormat("sq-AL", { style: "currency", currency }).format(
        value,
      );
}
