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
		expect(msg.contextMetadata).toMatchObject({
			instagramAccountId: "17841400008460056",
			metaDashboardTest: false,
		});
	});

	it("ignores echo messages", () => {
		const { messages, ignored } = parseInstagramWebhookPayload(loadFixture("echo.json"));
		expect(messages).toEqual([]);
		expect(ignored[0]?.reason).toBe("echo");
	});

	it("normalises Meta dashboard changes[].messages test payload", () => {
		const { messages, ignored } = parseInstagramWebhookPayload(
			loadFixture("changes-messages-test.json"),
		);
		expect(ignored).toEqual([]);
		expect(messages).toHaveLength(1);
		const msg = messages[0];
		expect(msg.externalMessageId).toBe("MESSAGE_ID");
		expect(msg.externalParticipantId).toBe("12334");
		expect(msg.text).toBe("TEXT_MESSAGE");
		expect(msg.contextMetadata).toMatchObject({
			instagramAccountId: "23245",
			metaDashboardTest: true,
		});
	});

	it("normalises real changes[].messages format like messaging[]", () => {
		const { messages, ignored } = parseInstagramWebhookPayload(
			loadFixture("changes-messages-real.json"),
		);
		expect(ignored).toEqual([]);
		expect(messages).toHaveLength(1);
		const msg = messages[0];
		expect(msg.externalMessageId).toBe("aWdfZG1fMTpJR01lc3NhZ2VJRDoy");
		expect(msg.externalParticipantId).toBe("1089304595302911");
		expect(msg.text).toBe("Pershendetje nga changes format");
		expect(msg.contextMetadata).toMatchObject({
			instagramAccountId: "17841400008460056",
			metaDashboardTest: false,
		});
	});
});
