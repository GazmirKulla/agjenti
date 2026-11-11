import { communicationPolicyInstructions } from "@/lib/agents/communication-policy";
import { trainingPrompt } from "@/lib/agents/training/model";
import { listPromptFiles, placeholders } from "./files";

/** The admin catalog of AI prompts: the files in /prompts (what the code
 * reads) plus the two parts the code builds from each agent's settings.
 * {{…}} marks a part filled for each request. Read-only. */

export type PromptArea = "agjenti-i-klienteve" | "asistenti" | "udhezimet" | "burimet" | "katalogu" | "onboarding";
export type PromptModel = "customer" | "assistant" | "utility" | "vision";
export type PromptEntry = {
  id: string;
  area: PromptArea;
  title: string;
  use: string;
  input?: string;
  output?: string;
  model: PromptModel;
  /** Parts filled for each request. */
  dynamic: string[];
  /** Where it is read: the prompt file, or the code that builds it. */
  file: string;
  code?: string;
  /** A piece of a larger prompt. */
  part: boolean;
  text: string;
};

export const PROMPT_AREAS: Record<PromptArea, { title: string; description: string }> = {
  "agjenti-i-klienteve": { title: "Agjenti i klientëve", description: "Bisedat me klientët në Instagram dhe WhatsApp: kuptimi i mesazhit, përgjigja, reagimet." },
  asistenti: { title: "Asistenti i pronarit", description: "Asistenti në panel që ndihmon pronarin të menaxhojë biznesin." },
  udhezimet: { title: "Udhëzimet e Agjentit", description: "Shkrimi dhe pastrimi i udhëzimeve të agjentit të klientëve." },
  burimet: { title: "Burimet dhe skanimi", description: "Leximi i Instagram-it, website-it dhe materialeve të biznesit." },
  katalogu: { title: "Katalogët dhe produktet", description: "Indeksimi i katalogëve, kërkimi në to dhe ndihma për produktet." },
  onboarding: { title: "Onboarding", description: "Pyetjet e para kur krijohet një biznes." },
};

const models = new Set<PromptModel>(["customer", "assistant", "utility", "vision"]);

export function promptCatalog(): PromptEntry[] {
  const files = listPromptFiles().map((file): PromptEntry => ({
    id: file.path, area: file.path.split("/")[0] as PromptArea, part: file.path.includes("/pjeset/"),
    title: file.meta.titulli || file.path, use: file.meta.perdorimi || "",
    input: file.meta.merr, output: file.meta.kthen,
    model: models.has(file.meta.modeli as PromptModel) ? file.meta.modeli as PromptModel : "assistant",
    dynamic: placeholders(file.body), file: `prompts/${file.path}.md`, code: file.meta.kodi, text: file.body,
  }));
  // Built in code from each agent's settings, shown for completeness.
  const built: PromptEntry[] = [
    {
      id: "kodi/politika-e-komunikimit", area: "agjenti-i-klienteve", part: true, model: "customer",
      title: "Politika e komunikimit (parazgjedhja)",
      use: "Pjesa e parë e përgjigjes ndaj klientit: gjuha, toni, gjatësia, pyetjet dhe emoji. Ndërtohet në kod nga zgjedhjet e çdo agjenti; kjo është parazgjedhja.",
      dynamic: [], file: "src/lib/agents/communication-policy.ts", text: communicationPolicyInstructions(),
    },
    {
      id: "kodi/mesimet-nga-memoria", area: "agjenti-i-klienteve", part: true, model: "customer",
      title: "Mësimet nga Memoria",
      use: "Shtohet te përgjigja kur biznesi ka mësime aktive: deri në 16 rregulla dhe 4 shembuj të afërt me pyetjen. Ndërtohet në kod.",
      dynamic: ["mesimi_i_pronarit"], file: "src/lib/agents/training/model.ts",
      text: trainingPrompt({ rules: [{ id: "shembull", kind: "style", instruction: "{{mesimi_i_pronarit}}", question: "", response: "", scope: "business" }] }),
    },
  ];
  return [...files, ...built];
}
