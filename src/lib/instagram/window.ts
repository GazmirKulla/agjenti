export const INSTAGRAM_WINDOW_CLOSED_CODE = "instagram_window_closed";
export const INSTAGRAM_WINDOW_CLOSED_MESSAGE =
	"Dritarja 24-orëshe ka mbaruar. Klienti duhet të shkruajë së pari.";

export function isInstagramMessagingWindowOpen(
	lastInboundAt: Date | string | null | undefined,
	now: Date = new Date(),
): boolean {
	if (!lastInboundAt) return false;
	const at = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
	if (Number.isNaN(at.getTime())) return false;
	return now.getTime() - at.getTime() < 24 * 60 * 60 * 1000;
}

export function instagramWindowClosedError(): { ok: false; error: string; code: string } {
	return {
		ok: false,
		error: INSTAGRAM_WINDOW_CLOSED_MESSAGE,
		code: INSTAGRAM_WINDOW_CLOSED_CODE,
	};
}
