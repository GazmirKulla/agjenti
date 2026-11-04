"use server";
import { getSessionUser } from "@/lib/tenant/access";
import { executeAgentTestTurn } from "./execute-turn";
import type { TestChatInput, TestChatResult } from "./types";

/** Compatibility entry point for existing isolated preview/tests. */
export async function simulateAgentTurn(input: TestChatInput): Promise<TestChatResult> {
  const user = await getSessionUser();
  if (!user) return { error: "Hyr në llogari për të provuar agjentin." };
  return executeAgentTestTurn(input, user.id);
}
