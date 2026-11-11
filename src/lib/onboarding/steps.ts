/** The onboarding order: 1. the business and where it is found (name,
 * Instagram, website, confirmed by the owner), 2. the short questions while
 * the confirmed sources are read, 3. what the agent learned, 4. the channel. */
export const ONBOARDING_STEPS = ["Biznesi", "Pyetjet", "Njohuritë", "Kanali"] as const;

const q = (slug: string) => `slug=${encodeURIComponent(slug)}`;
export const onboardingSourcesPath = (slug: string, sources: { instagramUsername?: string | null; website?: string | null } = {}) => {
  const params = new URLSearchParams({ slug });
  if (sources.instagramUsername) params.set("instagram", sources.instagramUsername);
  if (sources.website) params.set("website", sources.website);
  return `/onboarding/sources?${params.toString()}`;
};
export const onboardingQuestionsPath = (slug: string) => `/onboarding/questions?${q(slug)}`;
export const onboardingLearnedPath = (slug: string) => `/onboarding/learned?${q(slug)}`;
export const onboardingChannelPath = (slug: string) => `/onboarding/channel?${q(slug)}`;

/** After step 1: confirm the sources that were given, else straight to the questions. */
export function onboardingAfterCreate(slug: string, sources: { instagramUsername: string | null; website: string | null }) {
  return sources.instagramUsername || sources.website ? onboardingSourcesPath(slug, sources) : onboardingQuestionsPath(slug);
}
