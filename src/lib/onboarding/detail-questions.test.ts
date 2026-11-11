import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: vi.fn() }));
import { detailFields } from "./audio-fields";
import { DETAIL_QUESTIONS, NOT_ASKED } from "./detail-questions";
import { allQuestionKeys, emptyAnswers, parseAnswers } from "./model";
import { continuationQuestions } from "./continuation";

it("lists every detail question once, so the admin page stays complete", () => {
  const listed = DETAIL_QUESTIONS.map((question) => question.field);
  expect(new Set(listed).size).toBe(listed.length);
  expect([...listed, ...NOT_ASKED].sort()).toEqual(Object.keys(detailFields).sort());
});

it("matches the questions the profile actually asks", () => {
  const answers = parseAnswers({ ...emptyAnswers, name: "Zana", businessType: "retail", offeringTypes: ["personalized"], useCases: ["orders"] });
  const asked = continuationQuestions(answers, allQuestionKeys).filter((question) => !question.core).map((question) => question.field);
  for (const field of asked) expect(DETAIL_QUESTIONS.map((question) => question.field)).toContain(field);
});
