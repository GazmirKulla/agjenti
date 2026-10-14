/** Only known authentication destinations are accepted; never redirect to arbitrary URL input. */
export function authNext(raw: string | null): string {
  if (raw === "/auth/reset-password") return raw;
  if (raw === "/auth/mobile/continue") return raw;
  if (raw && /^\/join\?request=[A-Za-z0-9_-]{43}$/.test(raw)) return raw;
  return "/auth/continue";
}
