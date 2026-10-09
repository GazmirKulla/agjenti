import type { Choice } from "./rules";

const groups = [
  { id: "answers", label: "Përgjigje për klientët", description: "Përgjigjet mesazheve dhe pyetjeve duke përdorur informacionin e biznesit.", icon: "inbox", capabilities: ["reply_messages", "answer_questions", "answer_product_details"] },
  { id: "guidance", label: "Ndihmë në zgjedhje", description: "Kupton nevojat e klientit dhe e ndihmon të zgjedhë ofertën e përshtatshme.", icon: "spark", capabilities: ["understand_needs", "recommend_products", "compare_products"] },
  { id: "requests", label: "Përgatitje kërkesash", description: "Kërkon detajet që mungojnë dhe përgatit kërkesën për konfirmim.", icon: "orders", capabilities: ["ask_missing", "collect_order_details", "handle_bookings", "follow_workflow", "create_order"] },
  { id: "contacts", label: "Konteksti i klientit", description: "Organizon interesin dhe të dhënat e klientit për ndjekjen e bisedës.", icon: "customers", capabilities: ["qualify_leads", "recognize_customers", "save_customer_details"] },
  { id: "handoff", label: "Ndihmë nga stafi", description: "Ia kalon stafit rastet që kërkojnë ndërhyrje ose informacion shtesë.", icon: "businesses", capabilities: ["handoff"] },
];

export function capabilityGroups(options: readonly Choice[]) {
  const allowed = new Set(options.map(([id]) => id));
  return groups.map(group => ({ ...group, capabilities: group.capabilities.filter(id => allowed.has(id)) }))
    .filter(group => group.capabilities.length)
    .map(group => group.id === "requests" && group.capabilities.every(id => id === "ask_missing")
      ? { ...group, label: "Sqarimi i bisedës", description: "Pyet për informacionin që mungon për ta kuptuar kërkesën e klientit." }
      : group);
}

export function toggleCapabilityGroup(selected: readonly string[], capabilities: readonly string[]) {
  return capabilities.every(id => selected.includes(id))
    ? selected.filter(id => !capabilities.includes(id))
    : [...new Set([...selected, ...capabilities])];
}
