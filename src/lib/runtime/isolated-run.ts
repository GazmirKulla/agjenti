import { isolatedAvailableSlots } from "@/lib/calendar/isolated";
import {
  createIsolatedExecution,
  currentExecution,
  isIsolatedExecution,
  runWithExecution,
  type ExecutionContext,
} from "./execution-context";

function isolatedTurnContext(): ExecutionContext {
  const context = createIsolatedExecution();
  context.adapters.calendar = { availableSlots: isolatedAvailableSlots };
  return context;
}

/** Enter isolated Chat Lab/test execution. Nested calls keep the outer lock. */
export function runIsolated<T>(fn: () => T | Promise<T>): T | Promise<T> {
  if (isIsolatedExecution()) return fn();
  return runWithExecution(isolatedTurnContext(), fn);
}

export function isolatedWithoutAdapters<T>(
  fn: () => T | Promise<T>,
): T | Promise<T> {
  if (currentExecution().kind === "isolated") return fn();
  return runWithExecution(createIsolatedExecution(), fn);
}
