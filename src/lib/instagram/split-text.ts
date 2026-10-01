export const INSTAGRAM_TEXT_MAX_BYTES = 1000;

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function sliceToBytes(text: string, maxBytes: number): { head: string; rest: string } {
	if (byteLength(text) <= maxBytes) return { head: text, rest: "" };
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const bytes = encoder.encode(text);
	let end = maxBytes;
	while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
		end -= 1;
	}
	if (end <= 0) end = maxBytes;
	return {
		head: decoder.decode(bytes.subarray(0, end)),
		rest: decoder.decode(bytes.subarray(end)),
	};
}

function splitAtBoundary(chunk: string, maxBytes: number): { head: string; rest: string } {
	const { head } = sliceToBytes(chunk, maxBytes);
	const candidates: Array<(s: string) => number> = [
		(s) => s.lastIndexOf("\n"),
		(s) => Math.max(s.lastIndexOf(". "), s.lastIndexOf("! "), s.lastIndexOf("? ")),
		(s) => s.lastIndexOf(" "),
	];
	for (const find of candidates) {
		const idx = find(head);
		if (idx >= Math.min(40, Math.floor(head.length / 4))) {
			return { head: chunk.slice(0, idx + 1).trimEnd(), rest: chunk.slice(idx + 1) };
		}
	}
	const sliced = sliceToBytes(chunk, maxBytes);
	return { head: sliced.head, rest: sliced.rest };
}

export function splitInstagramText(text: string, maxBytes = INSTAGRAM_TEXT_MAX_BYTES): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	if (byteLength(trimmed) <= maxBytes) return [trimmed];

	const parts: string[] = [];
	let remaining = trimmed;
	while (remaining) {
		if (byteLength(remaining) <= maxBytes) {
			parts.push(remaining);
			break;
		}
		const { head, rest } = splitAtBoundary(remaining, maxBytes);
		if (!head) {
			const forced = sliceToBytes(remaining, maxBytes);
			parts.push(forced.head);
			remaining = forced.rest;
			continue;
		}
		parts.push(head);
		remaining = rest.trimStart();
	}
	return parts.filter(Boolean);
}
