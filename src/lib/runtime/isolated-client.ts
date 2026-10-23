import {
  isIsolatedExecution,
  refuseIsolatedEffect,
  isCollectionOnly,
  assertBusinessEffectAllowed,
} from "./execution-context";

/** Read-only RPCs used by conversation context. Unknown RPCs fail closed. */
const READ_RPC = new Set([
  // Module policy is read-only and must still be enforced in Chat Lab/tests.
  "allowed_business_modules",
  "search_catalog_sections",
  "can_execute_business_action",
  "workflow_runtime_readiness",
]);
const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

export function guardIsolatedClient<T extends object>(client: T): T {
  if (!isIsolatedExecution() && !isCollectionOnly()) return client;
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) =>
          guardBuilder(
            (target as { from: (table: string) => object }).from(table),
            table,
          );
      }
      if (prop === "rpc") {
        return (fn: string, args?: unknown) => {
          if (!READ_RPC.has(fn)) {
            assertBusinessEffectAllowed(`rpc:${fn}`);
            refuseIsolatedEffect("database.mutate", `rpc:${fn}`);
          }
          return (target as { rpc: (fn: string, args?: unknown) => unknown }).rpc(
            fn,
            args,
          );
        };
      }
      if (isCollectionOnly()) assertBusinessEffectAllowed(`supabase.${String(prop)}`);
      return Reflect.get(target, prop, receiver);
    },
  });
}

function guardBuilder(builder: object, table: string): object {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && WRITE_METHODS.has(prop)) {
        return () => {
          assertBusinessEffectAllowed(`${table}.${prop}`);
          return refuseIsolatedEffect("database.mutate", `${table}.${prop}`);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "then" || prop === "catch" || prop === "finally") {
        return value.bind(target);
      }
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (result instanceof Promise) return result;
        return result && typeof result === "object"
          ? guardBuilder(result, table)
          : result;
      };
    },
  });
}
