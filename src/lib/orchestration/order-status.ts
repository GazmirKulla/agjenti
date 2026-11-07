import { ownOrders, type OrderCustomerIdentity } from "@/lib/orders/own-orders";
import { requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { isIsolatedExecution, recordExternalAction } from "@/lib/runtime/execution-context";
import type { EffectResult, ToolAdapter } from "./execute";
import { TransitionError } from "./contracts";

/** Identity is supplied by the verified channel, never by the observation or action input. */
export function orderStatusAdapter(scope?: { businessId: string; conversationId: string; identity?: OrderCustomerIdentity }): ToolAdapter {
  return { key: "orders.status", version: 1,
    async execute(_action, context): Promise<EffectResult> {
      if (isIsolatedExecution() || !scope || scope.businessId !== context.businessId || scope.conversationId !== context.conversationId) throw new TransitionError("effect_scope_mismatch");
      await requireRuntimeModules(scope.businessId, ["orders", "workflows"]);
      const identity = scope.identity;
      if (!identity || identity.conversationId !== scope.conversationId) return { status: "failed", output: { code: "customer_identity_unverified" } };
      try {
        const orders = await ownOrders(scope.businessId, identity);
        if (!orders) return { status: "failed", output: { code: "customer_identity_unverified" } };
        return { status: "succeeded", output: { orders: JSON.stringify(orders), limit: 6, trackingAvailable: false } };
      } catch { return { status: "failed", output: { code: "order_status_unavailable" } }; }
    },
    async reconcile(_action, context): Promise<EffectResult | null> {
      if (isIsolatedExecution() || !scope || scope.businessId !== context.businessId || scope.conversationId !== context.conversationId) return null;
      try {
        await requireRuntimeModules(scope.businessId, ["orders", "workflows"]);
        const identity = scope.identity;
        if (!identity || identity.conversationId !== scope.conversationId) return { status: "failed", output: { code: "customer_identity_unverified" } };
        const orders = await ownOrders(scope.businessId, identity);
        if (!orders) return { status: "failed", output: { code: "customer_identity_unverified" } };
        return { status: "succeeded", output: { orders: JSON.stringify(orders), limit: 6, trackingAvailable: false } };
      } catch { return null; }
    },
    async simulate() {
      recordExternalAction({ kind: "orders.status", disposition: "SIMULATED", detail: "no_customer_orders_read" });
      return { status: "simulated", realOrdersRead: false };
    },
  };
}
