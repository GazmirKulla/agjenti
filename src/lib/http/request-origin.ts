/**
 * The public origin of a request (e.g. "https://www.agjenti.app").
 *
 * In the Docker image Next.js only knows its own listen address, so `request.url` in route
 * handlers reads "https://0.0.0.0:3000/...". The proxy in front (Traefik) passes the real
 * host and scheme in the Host / X-Forwarded-* headers, so redirects and self-calls use those.
 */
export function requestOrigin(request: Request): string {
	const fallback = new URL(request.url);
	const first = (value: string | null) => value?.split(",")[0]?.trim() || "";
	const host = first(request.headers.get("x-forwarded-host")) || first(request.headers.get("host"));
	if (!host || /^(0\.0\.0\.0|\[::\])(:|$)/.test(host)) return fallback.origin;
	const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
	const proto = first(request.headers.get("x-forwarded-proto")) || (local ? "http" : "https");
	return `${proto}://${host}`;
}
