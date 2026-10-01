import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type InstagramWebhookPayload,
	parseInstagramWebhookPayload,
} from "@/lib/instagram/parse-webhook";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function loadFixture(name: string): InstagramWebhookPayload {
	return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as InstagramWebhookPayload;
}

describe("parseInstagramWebhookPayload", () => {
	it("normalises a text DM", () => {
		const { messages, ignored } = parseInstagramWebhookPayload(loadFixture("text-dm.json"));
		expect(ignored).toEqual([]);
		expect(messages).toHaveLength(1);
		const msg = messages[0];
		expect(msg.channel).toBe("instagram");
		expect(msg.externalMessageId).toBe("aWdfZG1fMTpJR01lc3NhZ2VJRDox");
		expect(msg.externalParticipantId).toBe("1089304595302911");
		expect(msg.text).toBe("Përshëndetje, a bëni dërgesa jashtë vendit?");
		expect(msg.contextMetadata).toMatchObject({ instagramAccountId: "17841400008460056" });
	});

	it("ignores echo messages", () => {
		const { messages, ignored } = parseInstagramWebhookPayload(loadFixture("echo.json"));
		expect(messages).toEqual([]);
		expect(ignored[0]?.reason).toBe("echo");
	});
});
