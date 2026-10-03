/**
 * Public origin for the current request. Prefer the browser-facing host so
 * OAuth PKCE cookies and the callback stay on the same domain (www vs apex).
 */
export function appOrigin(request: Request): string {
	const forwardedHost = request.headers
		.get("x-forwarded-host")
		?.split(",")[0]
		?.trim();
	const proto =
		request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
	if (forwardedHost) return `${proto}://${forwardedHost}`;

	const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
	if (configured) return configured;

	return new URL(request.url).origin;
}
