import { AsyncLocalStorage } from "node:async_hooks";

/** The owner's Assistant request being served: its id ties the capability events to that turn of the conversation. */
const current = new AsyncLocalStorage<{ requestId: string }>();
export const withAssistantRequest = <T>(requestId: string, work: () => T): T => current.run({ requestId }, work);
export const assistantRequestId = () => current.getStore()?.requestId;
