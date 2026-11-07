"use client";
import type { ReactNode } from "react";
import { RowMenu, type RowMenuItem } from "./row-menu";
import "./list-toolbar.css";

/** List header shared by daily-work pages: filter and options menus, then the search field. */
export function ListToolbar({ subject, filters, activeFilters = 0, options, children }: {
  subject: string; filters?: RowMenuItem[]; activeFilters?: number; options?: RowMenuItem[]; children: ReactNode;
}) {
  return (
    <div className="list-toolbar">
      {filters?.length ? (
        <RowMenu
          label={`Filtro ${subject}`}
          title={`Filtro ${subject}`}
          items={filters}
          triggerClassName="btn btn-ghost list-tool"
          trigger={<>
            <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
            <span>Filtro</span>
            {activeFilters > 0 && <span className="list-tool-count" aria-label={`${activeFilters} aktivë`}>{activeFilters}</span>}
          </>}
        />
      ) : null}
      {options?.length ? (
        <RowMenu
          label="Opsionet e listës"
          title="Opsionet e listës"
          items={options}
          triggerClassName="btn btn-ghost list-tool"
          trigger={<>
            <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>
            <span>Opsione</span>
          </>}
        />
      ) : null}
      <div className="list-toolbar-search">{children}</div>
    </div>
  );
}
