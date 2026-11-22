import { expect, it } from "vitest";
import { requestOrigin } from "@/lib/http/request-origin";

const req = (headers: Record<string, string>, url = "https://0.0.0.0:3000/auth/callback") =>
	new Request(url, { headers });

it("uses the forwarded host and scheme from the proxy, not the container address", () => {
	expect(
		requestOrigin(
			req({
				host: "0.0.0.0:3000",
				"x-forwarded-host": "www.agjenti.app",
				"x-forwarded-proto": "https",
			}),
		),
	).toBe("https://www.agjenti.app");
	expect(requestOrigin(req({ host: "www.agjenti.app", "x-forwarded-proto": "https" }))).toBe(
		"https://www.agjenti.app",
	);
});

it("defaults to https for public hosts and http for local ones", () => {
	expect(requestOrigin(req({ host: "www.agjenti.app" }))).toBe("https://www.agjenti.app");
	expect(requestOrigin(req({ host: "localhost:3000" }, "http://localhost:3000/x"))).toBe(
		"http://localhost:3000",
	);
});

it("takes the first value of comma-separated forwarded headers", () => {
	expect(
		requestOrigin(
			req({ "x-forwarded-host": "www.agjenti.app, proxy.local", "x-forwarded-proto": "https,http" }),
		),
	).toBe("https://www.agjenti.app");
});

it("falls back to the request URL when no usable host header exists", () => {
	expect(requestOrigin(req({ host: "0.0.0.0:3000" }, "http://0.0.0.0:3000/x"))).toBe(
		"http://0.0.0.0:3000",
	);
});
