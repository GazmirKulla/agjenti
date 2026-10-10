import { createServiceSupabase } from "@/lib/supabase/service";
import { encryptSecret } from "@/lib/crypto/tokens";
import { sharedWorkflowEnabled } from "@/lib/workflows/context";
import { parseLinearDefinition, type LinearDefinition } from "@/lib/workflows/linear";
import { AssistantError, type Proposal, type Preview } from "./model";
import type { Access, Ticket } from "./service";
export type LinearCard = {
    products: {
        id: string;
        name: string;
        workflow_id: string | null;
    }[];
    versions: {
        id: string;
        workflow_id: string;
        name: string;
        steps: LinearDefinition["steps"];
    }[];
    draft?: {
        product_id: string;
        revision: number;
        definition: LinearDefinition;
        scope: string;
        source_workflow_id: string | null;
        published_revision?: number | null;
    };
    productId?: string;
    partial?: boolean;
};
function allow(access: Access) {
    if (!sharedWorkflowEnabled(access.businessId) || !access.modules.includes("workflows") || !access.modules.includes("products"))
        throw new AssistantError("Workflow-t e produkteve me AI nuk janë aktivizuar për këtë biznes.");
}
export async function loadLinearContext(access: Access, productId?: string | null): Promise<LinearCard> {
    allow(access);
    const db = createServiceSupabase();
    const [{ data: products, error: pe }, { data: versions, error: ve }] = await Promise.all([
        db.from("products").select("id,name,workflow_id").eq("business_id", access.businessId).order("name").limit(200),
        db.from("linear_workflow_versions").select("id,workflow_id,name,steps").eq("business_id", access.businessId).order("created_at", { ascending: false }).limit(1000),
    ]);
    if (pe || ve)
        throw new AssistantError("Nuk u ngarkuan workflow-t e produkteve. Kontrollo migrimin.");
    let selected = products?.find(p => p.id === productId);
    if (productId && !selected) {
        const { data, error } = await db.from("products").select("id,name,workflow_id").eq("id", productId).eq("business_id", access.businessId).maybeSingle();
        if (error || !data)
            throw new AssistantError("Produkti nuk u gjet në këtë biznes.");
        selected = data;
        products?.push(data);
    }
    const latest = [...new Map((versions ?? []).slice().reverse().map(v => [v.workflow_id, v])).values()];
    if (!productId)
        return { products: products ?? [], versions: latest, partial: (products?.length ?? 0) >= 200 || (versions?.length ?? 0) >= 1000 };
    const { data: draft, error } = await db.from("product_workflow_drafts").select("product_id,revision,definition,scope,source_workflow_id,published_revision").eq("business_id", access.businessId).eq("product_id", productId).maybeSingle();
    if (error)
        throw new AssistantError("Nuk u lexua drafti i produktit.");
    for (const workflowId of new Set([selected?.workflow_id, draft?.source_workflow_id].filter(Boolean))) {
        if (latest.some(v => v.workflow_id === workflowId))
            continue;
        const { data: version, error: versionError } = await db.from("linear_workflow_versions").select("id,workflow_id,name,steps").eq("business_id", access.businessId).eq("workflow_id", workflowId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (versionError || !version)
            throw new AssistantError("Versioni i workflow-t nuk u gjet.");
        latest.push(version);
    }
    return { products: products ?? [], versions: latest, productId, partial: (products?.length ?? 0) >= 200, ...(draft ? { draft } : {}) };
}
function describeDefinition(d?: LinearDefinition) {
    if (!d)
        return "—";
    const kinds = { text: "Tekst", choice: "Zgjedhje", photo: "Foto", customer: "Të dhënat e klientit", confirm: "Konfirmim" };
    return `${d.name}\n${d.steps.map((s, i) => `${i + 1}. ${s.label ?? kinds[s.kind]}${s.prompt ? ` — ${s.prompt}` : ""}${s.options?.length ? ` (${s.options.join(", ")})` : ""}`).join("\n")}`;
}
export async function prepareLinear(access: Access, p: Proposal, expected?: LinearCard) {
    const card = await loadLinearContext(access, p.id);
    if (p.action === "linear_read")
        return { message: "Workflow-t e produkteve dhe drafti shfaqen veçmas. Publikimi zbatohet për porositë e reja.", linear: card };
    if (!p.id)
        throw new AssistantError("Zgjidh produktin që dëshiron të ndryshosh.");
    if (expected && (expected.draft?.revision ?? 0) !== (card.draft?.revision ?? 0))
        throw new AssistantError("Drafti ndryshoi. Përgatite propozimin përsëri.");
    const product = card.products.find(v => v.id === p.id)!;
    const active = card.versions.find(v => v.workflow_id === product.workflow_id);
    if (expected) {
        const prior = expected.products.find(v => v.id === p.id);
        if (prior?.workflow_id !== product.workflow_id || expected.versions.find(v => v.workflow_id === prior?.workflow_id)?.id !== active?.id)
            throw new AssistantError("Workflow ndryshoi gjatë propozimit. Provo përsëri.");
    }
    const changes = Object.fromEntries(p.changes.map(c => [c.field, c.value]));
    let definition: LinearDefinition, scope = "product", source: string | null = null;
    try {
        if (p.action === "linear_publish") {
            if (!card.draft)
                throw new Error("Ruaj fillimisht draftin e produktit.");
            if (card.draft.published_revision === card.draft.revision)
                throw new Error("Ky draft është publikuar tashmë.");
            definition = parseLinearDefinition(card.draft.definition);
            scope = card.draft.scope;
            source = card.draft.source_workflow_id;
        }
        else if (p.action === "linear_link") {
            const target = card.versions.find(v => v.workflow_id === changes.workflow_id);
            if (!target)
                throw new Error("Zgjidh një workflow ekzistues të këtij biznesi.");
            if (expected && expected.versions.find(v => v.workflow_id === target.workflow_id)?.id !== target.id)
                throw new Error("Workflow i synuar ndryshoi. Provo përsëri.");
            definition = parseLinearDefinition(target);
            scope = "link";
            source = target.workflow_id;
        }
        else {
            definition = parseLinearDefinition(JSON.parse(changes.definition));
            scope = changes.scope ?? "product";
            if (!["product", "shared"].includes(scope))
                throw new Error("Zgjidh ndryshim për produktin ose workflow-n e përbashkët.");
        }
    }
    catch (e) {
        throw new AssistantError(e instanceof Error ? e.message : "Draft i pavlefshëm.");
    }
    const affected = scope === "shared" && product.workflow_id ? card.products.filter(v => v.workflow_id === product.workflow_id) : [product];
    // Read the complete affected set, never claim that a paginated catalog is exhaustive.
    const { data: allAffected, error } = scope === "shared" && product.workflow_id ? await createServiceSupabase().from("products").select("id,name").eq("business_id", access.businessId).eq("workflow_id", product.workflow_id) : { data: affected, error: null };
    if (error)
        throw new AssistantError("Nuk u lexuan produktet e prekura.");
    const preview: Preview = { title: p.action === "linear_publish" ? "Publiko workflow-n e produktit" : "Ruaj draftin e produktit", subject: product.name, fields: [
            { label: "Hapat", before: describeDefinition(p.action === "linear_publish" ? active : card.draft?.definition ?? active), after: describeDefinition(definition) },
            { label: "Produktet e prekura", before: "", after: (allAffected ?? []).map(v => v.name).join(", ") },
        ], notice: p.action === "linear_publish" ? "Porositë në vazhdim ruajnë versionin e tyre. Porositë e reja përdorin këtë version." : "Ruhet si draft. Lidhja dhe hapat aktivë ndryshojnë vetëm pas publikimit." };
    const ticket: Ticket = { purpose: "business-assistant-v1", userId: access.userId, businessId: access.businessId, expires: Date.now() + 600000, action: p.action, id: p.id, before: { revision: card.draft?.revision ?? 0, workflowId: product.workflow_id, versionId: active?.id ?? null, sourceVersionId: (source ? card.versions.find(v => v.workflow_id === source)?.id : active?.id) ?? null, affected: (allAffected ?? []).map(v => v.id).sort() }, values: { definition, scope, source, operation: p.action === "linear_publish" ? "publish" : "draft" } };
    return { message: p.message, preview, linear: card, token: encryptSecret(JSON.stringify(ticket)) };
}
export async function executeLinear(access: Access, t: Ticket) {
    allow(access);
    const card = await loadLinearContext(access, t.id), product = card.products.find(v => v.id === t.id)!;
    const active = card.versions.find(v => v.workflow_id === product.workflow_id);
    if ((card.draft?.revision ?? 0) !== t.before?.revision || product.workflow_id !== t.before?.workflowId || (active?.id ?? null) !== t.before?.versionId)
        throw new AssistantError("Workflow ndryshoi. Përgatite propozimin përsëri.");
    parseLinearDefinition(t.values.definition);
    const { error } = await createServiceSupabase().rpc("save_product_workflow", { p_business: access.businessId, p_user: access.userId, p_product: t.id, p_revision: t.before.revision, p_definition: t.values.definition, p_scope: t.values.scope, p_operation: t.values.operation, p_source: t.values.source, p_expected: t.before });
    if (error)
        throw new AssistantError("Nuk u ruajt workflow. Mund të ketë ndryshuar ndërkohë; rifresko propozimin.");
    return { saved: true, path: "workflows", message: t.values.operation === "publish" ? "Workflow i produktit u publikua." : "Drafti i produktit u ruajt. Provoje para publikimit.", linear: await loadLinearContext(access, t.id) };
}
export const linearInstructions = `For enabled shared workflow businesses, linear_load loads the product workflow catalog (id null, no changes); linear_read shows product workflows (id optional product ID). linear_draft edits ONE product's workflow: id is product ID; changes definition is JSON {name,steps:[{key,kind,label,prompt?,fieldKey?,fieldType?,options?,required?}]}, scope product (default copy when shared) or shared ONLY after explicit user selection. Preserve unrelated steps. Kinds text/choice/photo/customer/confirm; choice requires options; include customer step. Customer fields use stable fieldKey customer_name/customer_phone/customer_email/customer_city/customer_address. Product-specific fields use existing keys, e.g. collect_size, collect_color. linear_link proposes linking an existing workflow with changes workflow_id, id product ID. All draft/link operations require confirmation and do not publish. linear_publish publishes SAVED product draft, id product ID, changes []. Load actual catalog first, never invent IDs. Read data.linear and uiContext entity/linearProductId. Show affected products before shared changes. Ask whether insertion is on yes/no branch when ambiguous. No payments/reservations/custom code. New order final confirmation is provided by runtime; never claim an order was sent.`;
