"use client";
export function PrintButton() {
  return <button type="button" className="btn btn-primary" onClick={() => window.print()}>Printo ose ruaje si PDF</button>;
}
