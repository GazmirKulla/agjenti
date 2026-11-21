/* eslint-disable @next/next/no-img-element -- A small square logo from the business-logos bucket; next/image would need the storage host configured. */
/** The business's logo, or its initials when it has none (or before the logo loads). */
export function BusinessAvatar({ name, logoUrl, size = 29, initials }: { name: string; logoUrl?: string | null; size?: number; initials?: string }) {
  const letters = initials ?? name.slice(0, 2).toUpperCase();
  return <span className={`workspace-avatar${logoUrl ? " has-logo" : ""}`} style={size === 29 ? undefined : { width: size, height: size, fontSize: Math.round(size * 0.4) }}>
    {logoUrl ? <img src={logoUrl} alt="" width={size} height={size} loading="lazy" decoding="async" /> : letters}
  </span>;
}
