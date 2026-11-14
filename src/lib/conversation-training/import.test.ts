import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { conversationFileKind, isSystemText, mergeThreadParts, parseConversationFile, parseExportDate, parseExportHtml, parseExportJson, repairText } from "./instagram-export";
import { ArchiveError, readArchive, safeEntryName, ARCHIVE_LIMITS } from "./archive";
import { agentMessageHashes, exportThreadMessages, inboxThreadMessages, maskText, threadKey, toTurns, withoutDuplicates } from "./normalize";
import { ownerFrom } from "./job";

const BUSINESS = "2af8cfe5-5f63-47a1-baf3-959cfea49b79";
const OTHER = "11111111-2222-3333-4444-555555555555";
/** Instagram's export encodes UTF-8 bytes as Latin-1 characters. */
const mojibake = (text: string) => String.fromCharCode(...new TextEncoder().encode(text));
const T0 = Date.UTC(2025, 2, 10, 9, 0);

function exportJson(customer: string, lines: [string, string, number][]) {
  return JSON.stringify({
    participants: [{ name: mojibake(customer) }, { name: "Watchmaster" }],
    // Instagram lists the newest message first.
    messages: lines.map(([sender, content, minute]) => ({ sender_name: mojibake(sender), timestamp_ms: T0 + minute * 60_000, content: mojibake(content) })).reverse(),
    title: mojibake(customer), thread_path: `inbox/${customer}_1`,
  });
}
const glass = exportJson("Arbër Hoxha", [
  ["Arbër Hoxha", "Kam një Rolex kinez, më ra në tokë dhe u thye xhami. A bëhet?", 0],
  ["Watchmaster", "Po, besoj se bëhet. Ma sill ta shikoj.", 3],
  ["Arbër Hoxha", "Faleminderit.", 4],
  ["Watchmaster", "Faleminderit ju.", 5],
]);
const battery = exportJson("Ëndri", [
  ["Ëndri", "Përshëndetje", 100],
  ["Ëndri", "sa kushton bateria?", 101],
  ["Ëndri", "Liked a message", 101],
  ["Watchmaster", "Të thjeshtat Renata 200–500 lekë.", 110],
  ["Ëndri", "ok, numri im 069 123 4567", 111],
]);

describe("Instagram export files", () => {
  it("recognises conversation files of both layouts and nothing else", () => {
    expect(conversationFileKind("your_instagram_activity/messages/inbox/arber_123/message_1.json")).toBe("json");
    expect(conversationFileKind("messages/inbox/arber_123/message_2.html")).toBe("html");
    expect(conversationFileKind("messages/message_requests/x_1/message_1.json")).toBe("json");
    expect(conversationFileKind("messages/inbox/arber_123/photos/1.jpg")).toBeNull();
    expect(conversationFileKind("personal_information/personal_information.json")).toBeNull();
  });

  it("repairs Instagram's encoding of Albanian letters and emoji", () => {
    expect(repairText(mojibake("Përshëndetje, çmimi? 😊"))).toBe("Përshëndetje, çmimi? 😊");
    expect(repairText("Përshëndetje")).toBe("Përshëndetje");
    expect(repairText("Ã")).toBe("Ã");
  });

  it("reads a JSON conversation oldest first, without Instagram's notices", () => {
    const thread = parseExportJson(battery, "messages/inbox/endri_1/message_1.json")!;
    expect(thread.participants).toEqual(["Ëndri", "Watchmaster"]);
    expect(thread.messages.map((m) => m.text)).toEqual(["Përshëndetje", "sa kushton bateria?", "Të thjeshtat Renata 200–500 lekë.", "ok, numri im 069 123 4567"]);
    expect(isSystemText("Arbër reacted ❤️ to your message")).toBe(true);
    expect(isSystemText("You sent an attachment.")).toBe(true);
    expect(isSystemText("A e keni orën me rrip lëkure?")).toBe(false);
  });

  it("returns null for files that are not conversations", () => {
    expect(parseExportJson("{not json", "a.json")).toBeNull();
    expect(parseExportJson(JSON.stringify({ profile_user: [] }), "a.json")).toBeNull();
    expect(parseConversationFile("notes.txt", "hello")).toBeNull();
  });

  it("reads an HTML conversation, whatever its class names", () => {
    const html = `<html><head><title>Arbër</title><script>alert(1)</script></head><body>
      <div>Participants: Arbër Hoxha and Watchmaster</div>
      <div class="pam"><h2 class="_a6-h">Watchmaster</h2><div class="_a6-p"><div><div>Kur i &euml;sht&euml; b&euml;r&euml; servis p&euml;r her&euml; t&euml; fundit?</div></div></div><div class="_a6-o">Mar 10, 2025 9:05 am</div></div>
      <div class="pam"><h2 class="_a6-h">Arbër Hoxha</h2><div class="_a6-p"><div><div>Kam një orë Longines që më ecën 8 minuta mbrapa në ditë &amp; s&#039;di pse</div></div></div><div class="_a6-o">Mar 10, 2025, 9:01 AM</div></div>
      <div class="pam"><h2>Arbër Hoxha</h2><div><div>Liked a message</div></div><div>Mar 10, 2025 9:06 am</div></div>
    </body></html>`;
    const thread = parseExportHtml(html, "messages/inbox/arber_1/message_1.html")!;
    expect(thread.participants).toEqual(["Arbër Hoxha", "Watchmaster"]);
    const merged = mergeThreadParts([thread])!;
    expect(merged.messages.map((m) => [m.sender, m.text])).toEqual([
      ["Arbër Hoxha", "Kam një orë Longines që më ecën 8 minuta mbrapa në ditë & s'di pse"],
      ["Watchmaster", "Kur i është bërë servis për herë të fundit?"],
    ]);
  });

  it("reads the date formats of the HTML export", () => {
    expect(parseExportDate("Jan 05, 2024 3:12 pm")?.toISOString()).toBe("2024-01-05T15:12:00.000Z");
    expect(parseExportDate("Jan 05, 2024, 12:10 AM")?.toISOString()).toBe("2024-01-05T00:10:00.000Z");
    expect(parseExportDate("05 dhj 2024, 15:12")?.toISOString()).toBe("2024-12-05T15:12:00.000Z");
    expect(parseExportDate("2024-03-01 08:30:15")?.toISOString()).toBe("2024-03-01T08:30:15.000Z");
    expect(parseExportDate("dje në mbrëmje")).toBeNull();
  });
});

describe("ZIP archives", () => {
  const stream = (bytes: Uint8Array, chunk = 7_000) => new ReadableStream<Uint8Array>({
    start(controller) { for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.subarray(i, i + chunk)); controller.close(); },
  });

  it("reads only conversation files and skips media without reading it", async () => {
    const zip = zipSync({
      "your_instagram_activity/messages/inbox/arber_1/message_1.json": strToU8(glass),
      "your_instagram_activity/messages/inbox/arber_1/photos/a.jpg": new Uint8Array(200_000).fill(7),
      "your_instagram_activity/messages/inbox/endri_2/message_1.json": strToU8(battery),
      "personal_information/personal_information.json": strToU8("{}"),
    });
    const read = await readArchive(stream(zip));
    expect(read.total).toBe(2);
    expect(read.files.map((f) => f.path)).toEqual(["your_instagram_activity/messages/inbox/arber_1/message_1.json", "your_instagram_activity/messages/inbox/endri_2/message_1.json"]);
    expect(read.nextIndex).toBeNull();
  });

  it("continues in the next step when a step's size is reached", async () => {
    const zip = zipSync({ "messages/inbox/a_1/message_1.json": strToU8(glass), "messages/inbox/b_2/message_1.json": strToU8(battery) });
    const limits = { ...ARCHIVE_LIMITS, stepBytes: 600 };
    const first = await readArchive(stream(zip), 0, limits);
    expect(first.files.map((f) => f.index)).toEqual([0]);
    expect(first.nextIndex).toBe(1);
    const second = await readArchive(stream(zip), 1, limits);
    expect(second.files.map((f) => f.index)).toEqual([1]);
    expect(second.nextIndex).toBeNull();
  });

  it("refuses parent-directory and absolute names", async () => {
    expect(safeEntryName("messages/inbox/a/message_1.json")).toBe(true);
    expect(safeEntryName("../../etc/passwd")).toBe(false);
    expect(safeEntryName("messages/../../x/message_1.json")).toBe(false);
    expect(safeEntryName("/etc/passwd")).toBe(false);
    expect(safeEntryName("C:\\Windows\\x")).toBe(false);
    const zip = zipSync({ "messages/inbox/a_1/message_1.json": strToU8(glass), "../evil/message_1.json": strToU8("x") });
    await expect(readArchive(stream(zip))).rejects.toMatchObject({ code: "unsafe_path" });
  });

  it("skips a file that decompresses far beyond its size (zip bomb)", async () => {
    const bomb = strToU8(JSON.stringify({ participants: [], messages: [], pad: "a".repeat(3_000_000) }));
    const zip = zipSync({ "messages/inbox/a_1/message_1.json": bomb, "messages/inbox/b_2/message_1.json": strToU8(battery) }, { level: 9 });
    const read = await readArchive(stream(zip), 0, { ...ARCHIVE_LIMITS, ratio: 50 });
    expect(read.skipped).toEqual([{ path: "messages/inbox/a_1/message_1.json", reason: "ratio" }]);
    expect(read.files.map((f) => f.index)).toEqual([1]);
  });

  it("refuses files that are not ZIP archives and archives with too many entries", async () => {
    await expect(readArchive(stream(strToU8("not a zip at all")))).rejects.toBeInstanceOf(ArchiveError);
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`messages/inbox/a_${i}/photos/${i}.jpg`, new Uint8Array(1)]));
    await expect(readArchive(stream(zipSync(many)), 0, { ...ARCHIVE_LIMITS, entries: 10 })).rejects.toMatchObject({ code: "too_many_entries" });
  });
});

describe("training messages", () => {
  const thread = parseExportJson(battery, "messages/inbox/endri_1/message_1.json")!;

  it("finds the owner: the account in (nearly) every conversation", () => {
    expect(ownerFrom({ a: 5, b: 1, c: 1 }, { a: "Watchmaster" }, 5)).toBe("Watchmaster");
    expect(ownerFrom({ a: 2, b: 2 }, { a: "A", b: "B" }, 2)).toBeNull();
    expect(ownerFrom({ a: 1 }, { a: "A" }, 1)).toBeNull();
    expect(ownerFrom({ a: 2, b: 1 }, { a: "W" }, 6)).toBeNull();
  });

  it("tells the business's messages from the customer's and masks names and contacts", () => {
    const { messages } = exportThreadMessages(BUSINESS, thread, "Watchmaster");
    expect(messages.map((m) => [m.speaker, m.body])).toEqual([
      ["customer", "Përshëndetje"], ["customer", "sa kushton bateria?"],
      ["owner", "Të thjeshtat Renata 200–500 lekë."], ["customer", "ok, numri im [telefon]"],
    ]);
    expect(maskText("Faleminderit Arbër, kalo nesër", ["Arbër Hoxha"])).toBe("Faleminderit [emri], kalo nesër");
    expect(maskText("Rolex-i", ["Ro"])).toBe("Rolex-i");
    expect(JSON.stringify(messages)).not.toContain("Ëndri");
  });

  it("recognises the agent's own replies inside an export", () => {
    const agent = agentMessageHashes(BUSINESS, [{ body: "Të thjeshtat Renata 200–500 lekë.", created_at: new Date(T0 + 110 * 60_000 + 20_000).toISOString() }]);
    const { messages } = exportThreadMessages(BUSINESS, thread, "Watchmaster", agent);
    expect(messages.find((m) => m.body.startsWith("Të thjeshtat"))?.speaker).toBe("agent");
  });

  it("skips group conversations", () => {
    const group = { ...thread, participants: ["Watchmaster", "A", "B"] };
    expect(exportThreadMessages(BUSINESS, group, "Watchmaster").skipped).toBe("group");
  });

  it("keeps a message once across overlapping exports, a minute apart included", () => {
    const first = exportThreadMessages(BUSINESS, thread, "Watchmaster").messages;
    const shifted = { ...thread, messages: thread.messages.map((m) => ({ ...m, at: new Date(m.at.getTime() + 40_000) })) };
    const second = exportThreadMessages(BUSINESS, shifted, "Watchmaster").messages;
    expect(withoutDuplicates([...first, ...second])).toHaveLength(first.length);
    // The same reply to another customer is another message.
    const other = { ...thread, participants: ["Watchmaster", "Tjetri"], messages: thread.messages.map((m) => ({ ...m, sender: m.sender === "Ëndri" ? "Tjetri" : m.sender })) };
    expect(withoutDuplicates([...first, ...exportThreadMessages(BUSINESS, other, "Watchmaster").messages])).toHaveLength(first.length * 2);
  });

  it("keys conversations per business, so two businesses never share a key or a hash", () => {
    expect(threadKey(BUSINESS, "instagram:1")).not.toBe(threadKey(OTHER, "instagram:1"));
    const a = exportThreadMessages(BUSINESS, thread, "Watchmaster").messages;
    const b = exportThreadMessages(OTHER, thread, "Watchmaster").messages;
    expect(a.some((m) => b.some((n) => n.content_hash === m.content_hash || n.thread_key === m.thread_key))).toBe(false);
  });

  it("maps Inbox sources to speakers", () => {
    const rows = inboxThreadMessages(BUSINESS, "instagram:42", [
      { source: "customer", body: "A jeni hapur në fundjavë?", created_at: "2025-03-01T10:00:00Z" },
      { source: "agent", body: "Po, të shtunën deri në 14:00.", created_at: "2025-03-01T10:00:05Z" },
      { source: "staff", body: "Faleminderit ju.", created_at: "2025-03-01T10:02:00Z" },
      { source: "staff", body: "   ", created_at: "2025-03-01T10:03:00Z" },
    ]);
    expect(rows.map((r) => r.speaker)).toEqual(["customer", "agent", "owner"]);
  });

  it("joins quick consecutive messages of one person into one turn", () => {
    const { messages } = exportThreadMessages(BUSINESS, thread, "Watchmaster");
    expect(toTurns(messages).map((t) => [t.speaker, t.text])).toEqual([
      ["customer", "Përshëndetje\nsa kushton bateria?"],
      ["owner", "Të thjeshtat Renata 200–500 lekë."],
      ["customer", "ok, numri im [telefon]"],
    ]);
  });
});
