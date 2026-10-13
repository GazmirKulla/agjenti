/** Executable actions extend the existing capability registry; policy lives in the database. */
export const actionCatalog = {
  "business.provision": {
    name: "Përgatit biznes dhe krijo ftesë",
    description:
      "Krijon një biznes pa pronar dhe një ftesë për emailin e klientit.",
    version: 1,
    inputs: ["name", "email", "description"],
    outputs: ["businessId", "invitationUrl", "expiresAt"],
    automated: true,
  },
  "product.create": {
    name: "Krijo produkt",
    description: "Përdor formularin dhe validimin ekzistues të produkteve.",
    version: 1,
    inputs: ["name", "price"],
    outputs: ["productId"],
    automated: false,
  },
  "service.create": {
    name: "Krijo shërbim",
    description: "Përdor formularin dhe validimin ekzistues të shërbimeve.",
    version: 1,
    inputs: ["name"],
    outputs: ["serviceId"],
    automated: false,
  },
} as const;
export type ActionKey = keyof typeof actionCatalog;
export const isActionKey = (key: string): key is ActionKey =>
  Object.hasOwn(actionCatalog, key);
export type ActionBinding = {
  actionKey: "business.provision";
  actionVersion: 1;
  inputs: Record<string, string>;
};
const field = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;
export function validActionBinding(value: unknown): value is ActionBinding {
  if (!value || typeof value !== "object") return false;
  const v = value as ActionBinding;
  if(Object.keys(v).some(k=>!["actionKey","actionVersion","inputs"].includes(k))) return false;
  return (
    v.actionKey === "business.provision" &&
    v.actionVersion === 1 &&
    !!v.inputs &&
    typeof v.inputs === "object" &&
    !Array.isArray(v.inputs) &&
    Object.entries(v.inputs).every(
      ([k, x]) =>
        ["name", "email", "description"].includes(k) &&
        typeof x === "string" &&
        field.test(x) &&
        !["constructor", "prototype", "__proto__"].includes(x),
    )
  );
}
export function parseProvisionInput(input: Record<string, unknown>) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  if (name.length < 2 || name.length > 120)
    throw new Error("Emri duhet të ketë 2–120 karaktere.");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Vendos emailin e klientit që do të marrë biznesin.");
  if (description.length > 2000)
    throw new Error("Përshkrimi duhet të ketë deri në 2000 karaktere.");
  return { name, email, description };
}
