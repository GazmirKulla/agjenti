import { graphVersion } from "@/lib/instagram/oauth";

export type InstagramUserProfile = {
	username: string | null;
	name: string | null;
	/** Short-lived CDN link; copy the image, never store the link. */
	profilePic: string | null;
	/** False when the lookup did not reach a definitive answer (network or provider error). */
	ok: boolean;
};

const EMPTY = { username: null, name: null, profilePic: null };

/** Resolve public profile fields for an Instagram-scoped user id (IGSID). */
export async function fetchInstagramUserProfile(
	igsid: string,
	accessToken: string,
): Promise<InstagramUserProfile> {
	const url = new URL(
		`https://graph.instagram.com/${graphVersion()}/${encodeURIComponent(igsid)}`,
	);
	url.searchParams.set("fields", "username,name,profile_pic");
	url.searchParams.set("access_token", accessToken);

	try {
		const response = await fetch(url.toString(), {
			signal: AbortSignal.timeout(12_000),
		});
		const data = (await response.json()) as {
			username?: string;
			name?: string;
			profile_pic?: string;
			error?: { message?: string };
		};
		if (!response.ok) {
			console.warn("[instagram profile] lookup failed", {
				igsid,
				error: data.error?.message ?? response.status,
			});
			return { ...EMPTY, ok: false };
		}
		const pic = typeof data.profile_pic === "string" ? data.profile_pic.trim() : "";
		return {
			username: data.username?.trim() || null,
			name: data.name?.trim() || null,
			profilePic: /^https:\/\//.test(pic) ? pic : null,
			ok: true,
		};
	} catch (error) {
		console.warn("[instagram profile] lookup error", error);
		return { ...EMPTY, ok: false };
	}
}
