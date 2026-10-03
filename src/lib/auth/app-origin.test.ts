import { describe, expect, it } from "vitest";
import { appOrigin } from "./app-origin";

describe("appOrigin", () => {
	it("prefers x-forwarded-host over NEXT_PUBLIC_APP_URL", () => {
		const previous = process.env.NEXT_PUBLIC_APP_URL;
		process.env.NEXT_PUBLIC_APP_URL = "https://agjenti.app";
		const request = new Request("https://agjenti.app/auth/google", {
			headers: {
				"x-forwarded-host": "www.agjenti.app",
				"x-forwarded-proto": "https",
			},
		});
		expect(appOrigin(request)).toBe("https://www.agjenti.app");
		process.env.NEXT_PUBLIC_APP_URL = previous;
	});
});
