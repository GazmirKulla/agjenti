import { expect, it, vi } from "vitest";
import { IsolationViolation, isIsolatedExecution } from "./execution-context";
import { guardIsolatedClient } from "./isolated-client";
import { googleBusy } from "@/lib/calendar/google";
import { persistBooking } from "@/lib/calendar/service";

it("live execution is the default and does not wrap service-client writes", () => {
  expect(isIsolatedExecution()).toBe(false);
  const insert = vi.fn((row: { id: string }) => {
    void row;
    return "written";
  });
  const rpc = vi.fn((fn: string) => fn);
  const live = guardIsolatedClient({
    from(table: string) {
      void table;
      return { insert };
    },
    rpc,
  });
  expect(live.from("bookings").insert({ id: "1" })).toBe("written");
  expect(live.rpc("save_calendar_booking")).toBe("save_calendar_booking");
  expect(insert).toHaveBeenCalledOnce();
  expect(rpc).toHaveBeenCalledWith("save_calendar_booking");
});

it("live Google and booking persistence are not IsolationViolation refusals", async () => {
  expect(isIsolatedExecution()).toBe(false);
  await expect(googleBusy("business", "2026-10-15T07:00Z", "2026-10-15T08:00Z")).rejects.not.toBeInstanceOf(
    IsolationViolation,
  );
  await expect(
    persistBooking("business", {
      serviceId: "11111111-1111-4111-8111-111111111111",
      name: "Klienti",
      contact: "",
      start: "2026-10-15T07:00:00Z",
      status: "pending",
      notes: "",
    }),
  ).rejects.not.toBeInstanceOf(IsolationViolation);
});
