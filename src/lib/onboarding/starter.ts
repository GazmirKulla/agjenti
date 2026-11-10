import { createServiceSupabase } from "@/lib/supabase/service";
import { listMemberships } from "@/lib/tenant/access";
import { normalizeInstagramUsername } from "@/lib/instagram/public-profile";
import { normalizeWebsite, startOnboardingSources } from "@/lib/discovery/onboarding-sources";
import { persistGeneratedProfile } from "@/lib/dashboard/profile/service";
import { emptyDetails } from "./audio-fields";
import { businessCategories } from "./categories";
import { basicInstructions, emptyAnswers } from "./model";

  const publicTypes = new Set<string>(businessCategories.map(([id]) => id));
const starterCapabilities = {
  useCases: ["messages", "support"],
  agentCapabilities: ["reply_messages", "answer_questions", "handoff"],
};

export type StarterWorkspaceResult =
  | { ok: true; slug: string }
  | { error: string; status: 400 | 409 | 503 };
type ParsedStarter =
  | { error: string }
  | { name: string; businessType: string; categoryDescription: string; instagramUsername: string | null; website: string | null };

export function publicBusinessCategories(translate: (label: string) => string) {
  return businessCategories.map(([id, label]) => ({
    id,
    label: translate(label),
  }));
}

export function parseStarterWorkspace(input: unknown): ParsedStarter {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { error: "Kontrollo të dhënat e biznesit." };
  const raw = input as Record<string, unknown>;
  if (typeof raw.name !== "string")
    return { error: "Vendos emrin e biznesit (të paktën 2 karaktere)." };
  const name = raw.name.trim();
  if (name.length < 2)
    return { error: "Vendos emrin e biznesit (të paktën 2 karaktere)." };
  if (name.length > 100)
    return { error: "Emri i biznesit duhet të ketë deri në 100 karaktere." };
  if (typeof raw.businessType !== "string" || !publicTypes.has(raw.businessType))
    return { error: "Zgjidh llojin e biznesit." };
  const businessType = raw.businessType;
  const description =
    typeof raw.categoryDescription === "string"
      ? raw.categoryDescription.trim()
      : "";
  if (businessType === "other" && description.length < 2)
    return { error: "Përshkruaje shkurt biznesin." };
  if (description.length > 500)
    return { error: "Përshkrimi i biznesit është shumë i gjatë." };
  // Optional: the public Instagram the agent may learn from.
  const rawInstagram = typeof raw.instagramUsername === "string" ? raw.instagramUsername.trim() : "";
  const instagramUsername = rawInstagram ? normalizeInstagramUsername(rawInstagram) : null;
  if (rawInstagram && !instagramUsername)
    return { error: "Username i Instagram-it nuk është i vlefshëm. Lëre bosh ose shkruaj p.sh. @dyqani.im" };
  // Optional: the business website, read the same way.
  const rawWebsite = typeof raw.website === "string" ? raw.website.trim() : "";
  const website = rawWebsite ? normalizeWebsite(rawWebsite) : null;
  if (rawWebsite && !website)
    return { error: "Website nuk është i vlefshëm. Lëre bosh ose shkruaj p.sh. zana.al" };
  return {
    name,
    businessType,
    categoryDescription: businessType === "other" ? description : "",
    instagramUsername,
    website,
  };
}

export async function createStarterWorkspace(
  userId: string,
  input: unknown,
): Promise<StarterWorkspaceResult> {
  const parsed = parseStarterWorkspace(input);
  if ("error" in parsed) return { error: parsed.error, status: 400 };
  // Any number of businesses per person; platform administrators use the admin workspace.
  const access = await listMemberships(userId);
  if (access.admin)
    return { error: "Administratorët e platformës krijojnë bizneset nga paneli i administrimit.", status: 409 };
  const answers = {
    ...emptyAnswers,
    name: parsed.name,
    businessType: parsed.businessType,
    ...(parsed.categoryDescription
      ? {
          details: {
            ...emptyDetails,
            categoryDescription: parsed.categoryDescription,
          },
        }
      : {}),
  };
  try {
    const db = createServiceSupabase();
    const { error: draftError } = await db.rpc("save_onboarding_draft", {
      p_user_id: userId,
      p_answers: answers,
      p_step: 7,
    });
    if (draftError) {
      console.error("[onboarding draft]", draftError.code);
      return {
        error: "Hapësira nuk u krijua. Provo përsëri.",
        status: 503,
      };
    }
    const { data, error } = await db.rpc("complete_business_onboarding", {
      p_user_id: userId,
      p_answers: answers,
      p_instructions: basicInstructions(answers.name),
    });
    if (error) {
      console.error("[onboarding complete]", error.code);
      return {
        error: "Hapësira nuk u krijua. Provo përsëri.",
        status: 503,
      };
    }
    if (typeof data !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data))
      return {
        error: "Nuk u kthye një hapësirë e vlefshme. Provo përsëri.",
        status: 503,
      };
    try {
      const { data: business } = await db
        .from("businesses")
        .select("id")
        .eq("slug", data)
        .maybeSingle();
      if (business?.id) {
        await persistGeneratedProfile(business.id, {
          ...answers,
          ...starterCapabilities,
        });
        await startOnboardingSources(business.id, userId, parsed);
      }
    } catch (error) {
      console.error("[dashboard profile]", error);
    }
    return { ok: true, slug: data };
  } catch {
    return {
      error: "Nuk u lidhëm me shërbimin. Provo përsëri.",
      status: 503,
    };
  }
}
