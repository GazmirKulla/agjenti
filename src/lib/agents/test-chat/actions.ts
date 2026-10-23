"use server";
import { getSessionUser } from "@/lib/tenant/access";
import { executeAgentTestTurn, type TestChatInput, type TestChatResult } from "./execute-turn";
export type { TestChatInput, TestChatResult } from "./execute-turn";

/** Compatibility entry point for existing isolated preview/tests. */
export async function simulateAgentTurn(input: TestChatInput): Promise<TestChatResult> {
  const user = await getSessionUser();
  if (!user) return { error: "Hyr në llogari për të provuar agjentin." };
  return executeAgentTestTurn(input, user.id);
}
