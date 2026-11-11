import { prompt } from "@/lib/ai/prompts/files";
import { configurationOperations } from "@/lib/actions/operations/configuration-policy";

/** The pieces of the owner assistant's main prompt (prompts/asistenti/pjeset).
 * Server only: the modules the browser shares stay free of file reads. */

/** Prompt text: prompts/asistenti/pjeset/konfigurimi.md */
export const configurationInstructions = () => prompt("asistenti/pjeset/konfigurimi", { operacionet: configurationOperations.join(", ") });
/** Prompt text: prompts/asistenti/pjeset/porosite.md */
export const orderFlowInstructions = () => prompt("asistenti/pjeset/porosite");
/** Prompt text: prompts/asistenti/pjeset/linear.md */
export const linearInstructions = () => prompt("asistenti/pjeset/linear");
/** Prompt text: prompts/asistenti/pjeset/workflow-planifikimi.md */
export const workflowPlanningContract = () => prompt("asistenti/pjeset/workflow-planifikimi");
/** Prompt text: prompts/asistenti/pjeset/automatizimet.md */
export const automationInstructions = () => prompt("asistenti/pjeset/automatizimet");
/** Prompt text: prompts/asistenti/pjeset/plani-i-veprimeve.md */
export const actionPlanInstructions = () => prompt("asistenti/pjeset/plani-i-veprimeve");
/** Prompt text: prompts/asistenti/pjeset/workflow-editori.md */
export const workflowEditorInstructions = () => prompt("asistenti/pjeset/workflow-editori");
