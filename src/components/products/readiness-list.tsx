import type { ReadinessItem } from "@/lib/products/readiness";

/** One readiness list everywhere: each missing item says why it matters and links to where it is filled. */
export function ReadinessList({ items, hrefFor }: { items: ReadinessItem[]; hrefFor: (anchor: string) => string }) {
  const required = items.filter(item => !item.optional);
  const done = required.filter(item => item.done).length;
  return (
    <div className="product-readiness">
      <div className="product-readiness-head">
        <strong>{done === required.length ? "Gati për Agjentin" : `${done} nga ${required.length} gati`}</strong>
        <progress value={done} max={required.length} aria-label="Gatishmëria për Agjentin" />
      </div>
      <ul className="product-checklist">
        {items.map(item => (
          <li key={item.key} className={item.done ? "is-complete" : ""}>
            <span aria-hidden>{item.done ? "✓" : "○"}</span>
            <span className="product-readiness-text">
              <span>{item.label}{item.optional ? " (opsionale)" : ""}</span>
              {!item.done && <small>{item.hint} <a className="inline-link" href={hrefFor(item.anchor)}>Plotëso →</a></small>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
