import { graphVersion } from "@/lib/instagram/oauth";

export type InstagramUserProfile = {
	username: string | null;
	name: string | null;
};

/** Resolve public profile fields for an Instagram-scoped user id (IGSID). */
export async function fetchInstagramUserProfile(
	igsid: string,
	accessToken: string,
): Promise<InstagramUserProfile> {
	const url = new URL(
		`https://graph.instagram.com/${graphVersion()}/${encodeURIComponent(igsid)}`,
	);
	url.searchParams.set("fields", "username,name");
	url.searchParams.set("access_token", accessToken);

	try {
		const response = await fetch(url.toString(), {
			signal: AbortSignal.timeout(12_000),
		});
		const data = (await response.json()) as {
			username?: string;
			name?: string;
			error?: { message?: string };
		};
		if (!response.ok) {
			console.warn("[instagram profile] lookup failed", {
				igsid,
				error: data.error?.message ?? response.status,
			});
			return { username: null, name: null };
		}
		return {
			username: data.username?.trim() || null,
			name: data.name?.trim() || null,
		};
	} catch (error) {
		console.warn("[instagram profile] lookup error", error);
		return { username: null, name: null };
	}
}
