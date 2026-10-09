"use server";
import { processBookingTurn } from "@/lib/calendar/agent";

import { randomUUID } from "node:crypto";
import { issueTrainingReceipt } from "@/lib/agents/training/receipt";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { processAgentTurn } from "@/lib/conversations/process-agent-turn";
import { readTestSession, sealTestSession, snapshotTestSession } from "@/lib/agents/test-chat/session";
import type { TimedTraceEvent } from "@/lib/conversations/trace";
import type { WorkflowStepDef } from "@/lib/workflows/engine";
import { redactDebug, workflowFields, type LabBusiness, type LabSetup, type LabResult } from "./model";

async function adminId() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) throw new Error("Admin access required.");
  return user.id;
}
const validId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);

export async function searchLabBusinesses(query: string): Promise<{ businesses: LabBusiness[]; error?: string }> {
  try {
    await adminId();
    if (typeof query !== "string" || query.length > 100) return { businesses: [], error: "Search must be under 100 characters." };
    const db = createServiceSupabase();
    const result = await db.from("businesses").select("id,name,slug")
      .ilike("name", `%${query.replace(/[\\%_]/g, "\\$&")}%`).order("name").limit(50);
    if (result.error) throw new Error();
    return { businesses: result.data ?? [] };
  } catch { return { businesses: [], error: "Unable to load businesses. Platform admin access is required." }; }
}

export async function loadLabSetup(businessId: string): Promise<{ setup: LabSetup } | { error: string }> {
  try {
    await adminId();
    if (!validId(businessId)) throw new Error();
    const db = createServiceSupabase();
    const [business, products, services, workflows, channels, onboarding] = await Promise.all([
      db.from("businesses").select("id,name,slug").eq("id", businessId).single(),
      db.from("products").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("is_active", true),
      db.from("knowledge_entries").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("is_active", true).eq("intent_key", "service"),
      db.from("workflows").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      db.from("instagram_connections").select("username,status").eq("business_id", businessId),
      db.from("business_onboarding").select("answers").eq("business_id", businessId).maybeSingle(),
    ]);
    if ([business, products, services, workflows, channels, onboarding].some((r) => r.error) || !business.data) throw new Error();
    const answers = onboarding.data?.answers;
    const type = answers?.businessType ?? answers?.businessProfile?.businessType;
    return { setup: { ...business.data, businessType: typeof type === "string" ? type : "Not configured", products: products.count ?? 0, services: services.count ?? 0, workflows: workflows.count ?? 0, channels: channels.data ?? [] } };
  } catch { return { error: "Unable to load business setup. Check access and try again." }; }
}

export async function runLabTurn(input: { businessId: string; message: string; hasPhoto?: boolean; session?: string | null }): Promise<LabResult> {
  const trace: TimedTraceEvent[] = [];
  let start = Date.now();
  try {
    const userId = await adminId();
    if (!input || !validId(input.businessId) || typeof input.message !== "string" || input.message.length > 2000 || (!input.message.trim() && !input.hasPhoto) || (input.hasPhoto !== undefined && typeof input.hasPhoto !== "boolean") || (input.session != null && typeof input.session !== "string")) return { error: "Invalid test message (maximum 2,000 characters)." };
    if (!process.env.TOKEN_ENCRYPTION_KEY?.trim()) return { error: "Test session encryption is not configured." };
    const db = createServiceSupabase();
    const business = await db.from("businesses").select("id").eq("id", input.businessId).single();
    if (business.error || !business.data) return { error: "Business no longer exists." };
    let session;
    try {
      session = readTestSession(input.session ?? null, userId, input.businessId);
      if (input.session && !session.testConversationId?.startsWith("test_")) throw new Error();
    } catch { return { error: "This test session expired or is invalid. Start a new test conversation." }; }
    session.testConversationId ??= `test_${randomUUID()}`;
    const replaySession = snapshotTestSession(session);
    start = Date.now();
    // Deliberately call the read-only production core, never the inbound delivery
    // handler or onboarding test action. No persistence, order, booking or webhook
    // capability is supplied to this adapter. New side effects belong outside core.
    const bookingTurn = await processBookingTurn({businessId: input.businessId, message: input.message.trim(), state: session.state, mode: "test", onTrace: (event) => trace.push({ ...structuredClone(event), elapsedMs: Date.now() - start })});
    const result = bookingTurn ?? await processAgentTurn({
      businessId: input.businessId, message: input.message.trim(), hasPhoto: input.hasPhoto === true,
      state: session.state, previousResponseId: session.previousResponseId,
      mode: "test", source: "admin_chat_lab",
      onTrace: (event) => trace.push({ ...structuredClone(event), elapsedMs: Date.now() - start }),
    });
    trace.push({ stage: "tools", label: "External actions disabled", status: "skipped", elapsedMs: Date.now() - start, data: { policy: "No customer sends, database mutations, orders, bookings, payments or business webhooks. Appointment requests are simulated in test mode; the shared reply core remains read-only." } });
    trace.push({ stage: "overview", label: "Response finalized", elapsedMs: Date.now() - start, data: { response: result.reply, source: result.debug.source } });
    const workflow = trace.find((event) => event.stage === "workflow");
    const fields = workflowFields(result.nextState, (workflow?.data?.steps ?? []) as WorkflowStepDef[]);
    const warnings = [
      ...(result.debug.fallbackReason ? [`Fallback: ${result.debug.fallbackReason}`] : []),
      ...(!result.debug.agentConfigured ? ["No active business instructions; default instructions used."] : []),
      ...trace.filter((event) => event.status === "error").map((event) => event.label),
    ];
    const safe = redactDebug({ ...result, trace, fields, warnings, input: input.message.trim() }) as typeof result & { trace: TimedTraceEvent[]; fields: typeof fields; warnings: string[]; input: string };
    return { ...safe, trainingReceipt: issueTrainingReceipt(userId, input.businessId, safe.input || "[Foto e simuluar]", safe.reply, result.workflowId, result.nextState.step_key), replaySession, session: sealTestSession(session, result.nextState, result.previousResponseId), testConversationId: session.testConversationId, turns: session.turns + 1, timestamp: new Date().toISOString() };
  } catch {
    if (trace.length) trace.push({ stage: "logs", label: "Execution failed; state not committed", status: "error", elapsedMs: Date.now() - start });
    return { error: "Test execution failed. Check the business configuration and try again. No real actions were performed.", ...(trace.length ? { trace: redactDebug(trace) as TimedTraceEvent[] } : {}) };
  }
}
