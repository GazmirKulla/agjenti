/** Created only by a domain adapter after its server result. Never accepted
 * from model output, customer text, configured prompts or browser requests. */
export type ExecutionReceipt = {
  operation: "business.provision" | "booking.create";
  status: "succeeded" | "simulated" | "unconfirmed";
  reference?: string;
};
