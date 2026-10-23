import { describe, expect, it } from "vitest";
import { emptyState } from "@/lib/workflows/engine";
import { conversationControl } from "./conversation-control";
import { migrateContext } from "@/lib/workflows/context";
import { snapshotOrder } from "@/lib/workflows/conversation-processes";
const state = (reply: string) => ({ ...emptyState(), product_id: "pdf", step_key: "collect_customer", recentMessages: [{ role: "assistant" as const, content: reply }] });
it.each(["order", "booking"] as const)("uses the current %s graph confirmation independently of prompt language", owner => {
    const s = migrateContext(state("Confirm A?"));
    s.visual = { versionId: "A", nodeId: "review", status: "waiting", awaiting: true, values: {}, visited: [],
        pendingConfirmation: { nodeId: "review", factsKey: "checked-by-runtime", expiresAt: Date.now() + 60000 } };
    s.processes = { active: owner, promptOwner: owner,
        ...(owner === "order" ? { order: { id: "p", status: "active" as const, snapshot: snapshotOrder(s) } }
            : { booking: { id: "p", status: "active" as const, visual: s.visual } }) };
    const input = { businessId: "business", message: "po", state: s, hasPhoto: false, mode: "production" as const };
    expect(conversationControl({ ...input, deliveredReply: "Confirm A?" })).toBeNull();
    expect(conversationControl({ ...input, deliveredReply: null })).not.toBeNull();
    s.processes.promptOwner = null;
    expect(conversationControl({ ...input, deliveredReply: "Confirm A?" })).not.toBeNull();
});
describe("conversation control before workflow execution", () => {
    it.each(["Ok", "Faleminderit", "Në rregull", "👍", "Po"])("does not turn %s after information into an order", message => {
        const before = state("Material PDF, 690 ALL. Porositeni në website.");
        const result = conversationControl({ businessId: "business", message, state: before, mode: "test", hasPhoto: false });
        expect(result?.reply).toBeTruthy();
        expect(result?.nextState.step_key).toBe(before.step_key);
        expect(result?.nextState.customer).toEqual(before.customer);
        expect(before.recentMessages).toHaveLength(1);
    });
    it("allows an answer to a current specific proposal", () => {
        expect(conversationControl({ businessId: "business", message: "Po", state: state("Ta vazhdojmë porosinë për Aktivitetet Montessori?"), mode: "test", hasPhoto: false })).toBeNull();
    });
    it.each([undefined, null, "Pyetje tjetër"])("does not trust an unverified production prompt %s", deliveredReply => {
        expect(conversationControl({ businessId: "business", message: "Ok", state: state("Ta vazhdojmë porosinë për Montessori?"), deliveredReply, hasPhoto: false })?.reply).toBeTruthy();
    });
    it("allows a delivered production proposal", () => {
        const prompt = "Ta vazhdojmë porosinë për Montessori?";
        expect(conversationControl({ businessId: "business", message: "Po", state: state(prompt), deliveredReply: prompt, hasPhoto: false })).toBeNull();
    });
    it("does not consume a customer field with an acknowledgement", () => {
        expect(conversationControl({ businessId: "business", message: "Ok", state: state("Na jepni telefonin, qytetin, adresën."), mode: "test", hasPhoto: false })?.reply).toBeTruthy();
    });
    it.each(["Jo tani", "Ok\njo tani", "Do ta mendoj", "Vetëm po pyes"])("suspends on %s without losing the draft", message => {
        const before = state("Ta vazhdojmë porosinë për Montessori?");
        const paused = conversationControl({ businessId: "business", message, state: before, mode: "test", hasPhoto: false })!;
        expect(paused.nextState.conversationPaused).toBe(true);
        expect(paused.nextState.product_id).toBe("pdf");
        expect(conversationControl({ businessId: "business", message: "Ok", state: paused.nextState, mode: "test", hasPhoto: false })?.nextState.conversationPaused).toBe(true);
    });
    it("preserves a yes/no field response and lets explicit orders and cancellation reach their existing engines", () => {
        for (const message of ["Dua ta porosis", "Anulo", "Sa kushton?"])
            expect(conversationControl({ businessId: "business", message, state: state("PDF"), mode: "test", hasPhoto: false })).toBeNull();
        expect(conversationControl({ businessId: "business", message: "Jo", state: state("A dëshironi personalizim?"), mode: "test", hasPhoto: false })).toBeNull();
    });
    it("invalidates an old confirmation after an informational interruption", () => {
        const s = state("Ta konfirmojmë porosinë?");
        s.recentMessages.push({ role: "assistant", content: "Çmimi është 690 ALL." });
        expect(conversationControl({ businessId: "business", message: "Po", state: s, mode: "test", hasPhoto: false })?.reply).toBeTruthy();
    });
});
it.each(["OK 👍", "ok\nfaleminderit", "👍", "❤️"])("handles acknowledgements with reactions: %s", message => {
    expect(conversationControl({ businessId: "business", message, state: state("PDF, në website."), mode: "test", hasPhoto: false })?.reply).toBeTruthy();
});
it("does not accept a generic offer of more information as purchase consent", () => {
    expect(conversationControl({ businessId: "business", message: "Po", state: state("A dëshironi më shumë informacion?"), mode: "test", hasPhoto: false })?.nextState.step_key).toBe("collect_customer");
});
it("recognizes a specific proposal after a product description", () => {
    expect(conversationControl({ businessId: "business", message: "Po", state: state("Materiali kushton 690 ALL. Ta vazhdojmë porosinë për Montessori?"), mode: "test", hasPhoto: false })).toBeNull();
});
it("does not treat a choice between information and ordering as a yes/no proposal", () => {
    expect(conversationControl({ businessId: "business", message: "Po", state: state("Dëshiron informacion apo të vazhdojmë porosinë?"), mode: "test", hasPhoto: false })?.reply).toBeTruthy();
});
it.each(["Ndoshta", "Nuk e di", "Hmm"])("does not treat uncertainty as permission: %s", message => {
    const before = state("Ta vazhdojmë porosinë për Montessori?");
    const result = conversationControl({ businessId: "business", message, state: before, mode: "test", hasPhoto: false });
    expect(result?.nextState.conversationPaused).toBe(true);
    expect(result?.nextState.step_key).toBe(before.step_key);
});
