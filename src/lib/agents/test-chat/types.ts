import type { AgentTurnResult } from "@/lib/conversations/process-agent-turn";

export type TestChatInput = {
  configurationDraft?: string;
  slug: string;
  message: string;
  hasMedia?: boolean;
  session?: string | null;
  attachments?: string[];
};
export type TestChatResult =
  | { error: string }
  | (AgentTurnResult & {
      setupTestPassed?: boolean;
      setupNotice?: string;
      session: string;
      turns: number;
      autoReplyEnabled: boolean;
      trainingReceipt?: string;
    });
