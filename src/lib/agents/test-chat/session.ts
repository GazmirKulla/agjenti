import { decryptSecret, encryptSecret } from "@/lib/crypto/tokens";
import {
  emptyState,
  type ConversationStatePayload,
} from "@/lib/workflows/engine";
const PURPOSE = "agjenti-agent-test-v1";
const TTL = 60 * 60 * 1000;
export const MAX_TEST_TURNS = 40;
type TestSession = {
  attachments?: { name: string; kind: "image" | "document"; text: string }[];
  testConversationId?: string;
  setupSignature?: string | null;
  /** True once any turn in this session got a real AI reply under a stable config. */
  sawAi?: boolean;
  purpose: typeof PURPOSE;
  userId: string;
  businessId: string;
  expiresAt: number;
  turns: number;
  state: ConversationStatePayload;
  previousResponseId: string | null;
};
export function readTestSession(
  token: string | null,
  userId: string,
  businessId: string,
): TestSession {
  if (!token)
    return {
      purpose: PURPOSE,
      userId,
      businessId,
      expiresAt: Date.now() + TTL,
      turns: 0,
      state: emptyState(),
      previousResponseId: null,
    };
  try {
    if (token.length > 128000) throw new Error();
    const session = JSON.parse(decryptSecret(token)) as TestSession;
    if (
      session.purpose !== PURPOSE ||
      session.userId !== userId ||
      session.businessId !== businessId ||
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= Date.now() ||
      !Number.isInteger(session.turns) ||
      session.turns < 0 ||
      session.turns >= MAX_TEST_TURNS ||
      !session.state ||
      !session.state.fields ||
      !session.state.customer ||
      (session.previousResponseId !== null &&
        typeof session.previousResponseId !== "string")
    )
      throw new Error();
    return session;
  } catch {
    throw new Error(
      "Sesioni i provës ka skaduar ose nuk është i vlefshëm. Shtyp Rifillo.",
    );
  }
}
export function sealTestSession(
  session: TestSession,
  state: ConversationStatePayload,
  previousResponseId: string | null,
) {
  return encryptSecret(
    JSON.stringify({
      ...session,
      state,
      previousResponseId,
      turns: session.turns + 1,
      expiresAt: Date.now() + TTL,
    }),
  );
}

/** Encrypted checkpoint for replay, without consuming a turn. */
export function snapshotTestSession(session: TestSession) {
  return encryptSecret(JSON.stringify(session));
}
