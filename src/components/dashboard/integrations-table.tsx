"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SecretReveal } from "@/components/dashboard/secret-reveal";
import { StatusBadge, formatDate } from "@/components/dashboard/ui";

export type IntegrationRow = {
  id: string;
  businessId: string;
  businessName: string;
  businessSlug: string;
  username: string | null;
  status: string;
  lastError: string | null;
  refreshedAt: string | null;
  token: string | null;
};

export function IntegrationsTable({ rows }: { rows: IntegrationRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selectedId) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [selectedId]);

  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Biznesi</th>
              <th>Llogaria</th>
              <th>Statusi</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.businessName}</td>
                <td>{row.username ? `@${row.username}` : "—"}</td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td>
                  <button
                    className="text-accent"
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                  >
                    Detaje →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="muted-copy py-6">
            Ende nuk ka llogari Instagram të lidhura.
          </p>
        )}
      </div>

      <dialog
        ref={dialogRef}
        className="record-create-dialog"
        style={{ width: "min(520px, 94vw)" }}
        aria-labelledby="integration-detail-title"
        onClose={() => setSelectedId(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setSelectedId(null);
        }}
      >
        {selected && (
          <div className="record-create-dialog-body">
            <header className="record-create-dialog-head">
              <div>
                <h2 id="integration-detail-title">{selected.businessName}</h2>
                <p className="muted-copy" style={{ margin: "0.25rem 0 0" }}>
                  {selected.username ? `@${selected.username}` : "Pa username"}
                </p>
              </div>
              <button
                className="btn btn-ghost"
                type="button"
                aria-label="Mbyll"
                onClick={() => setSelectedId(null)}
              >
                ×
              </button>
            </header>

            <div className="detail-block">
              <h3>Statusi</h3>
              <StatusBadge status={selected.status} />
              {selected.lastError && (
                <p className="text-danger mt-2">{selected.lastError}</p>
              )}
            </div>

            <div className="detail-block">
              <h3>Access token</h3>
              {selected.token ? (
                <SecretReveal value={selected.token} label="Access token" />
              ) : (
                <p className="muted-copy">I padisponueshëm</p>
              )}
            </div>

            <div className="detail-block">
              <h3>Rifreskimi i token-it</h3>
              <p>{formatDate(selected.refreshedAt)}</p>
            </div>

            <div className="flex flex-col gap-3 items-start mt-4">
              <Link
                className="text-accent"
                href={`/b/${selected.businessSlug}/instagram`}
              >
                Menaxho →
              </Link>
              <form
                action={`/api/businesses/${selected.businessId}/instagram/disconnect`}
                method="post"
              >
                <button className="btn btn-ghost text-danger" type="submit">
                  Shkëput llogarinë
                </button>
              </form>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
