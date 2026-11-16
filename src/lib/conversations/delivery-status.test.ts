import { expect, it } from "vitest";
import { showsInlineDelivery, threadReceipt } from "./delivery-status";

const out = (delivery_status: string | null) => ({ direction: "outbound", delivery_status });
const customer = { direction: "inbound", delivery_status: "delivered" };

it("labels only the newest message, and only when it is ours and accepted by the channel", () => {
  expect(threadReceipt([customer, out("read")])).toBe("read");
  expect(threadReceipt([out("read"), out("sent")])).toBe("sent");
  expect(threadReceipt([out("delivered")])).toBe("delivered");
  // The customer answered after our message: no receipt, as in Instagram.
  expect(threadReceipt([out("read"), customer])).toBeNull();
  // Problems and in-progress sends are not receipts.
  for (const status of ["failed", "uncertain", "sending", null]) expect(threadReceipt([out(status)])).toBeNull();
  expect(threadReceipt([])).toBeNull();
});

it("keeps problem statuses on the bubble and drops routine ones", () => {
  for (const status of ["failed", "uncertain", "sending", "pending"]) expect(showsInlineDelivery("outbound", status)).toBe(true);
  for (const status of ["sent", "delivered", "read", null]) expect(showsInlineDelivery("outbound", status)).toBe(false);
  expect(showsInlineDelivery("inbound", "delivered")).toBe(false);
});
