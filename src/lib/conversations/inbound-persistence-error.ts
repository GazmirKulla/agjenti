// Keep retry diagnostics safe to persist: database messages can contain customer
// data. Correlation IDs identify a queue job or one direct ingestion attempt.
export class InboundPersistenceError extends Error {
  constructor(
    readonly correlationId: string,
    readonly stage: "message_insert" | "duplicate_lookup" | "event_receipt",
    readonly databaseCode: string | null,
  ) {
    super(`Inbound persistence failed [${correlationId}] ${stage}${databaseCode ? ` (${databaseCode})` : ""}`);
    this.name = "InboundPersistenceError";
  }
}
