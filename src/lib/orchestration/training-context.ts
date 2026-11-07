import { loadActiveTrainingMemories } from "@/lib/agents/training/load";
import { selectTrainingContext } from "@/lib/agents/training/model";
import type { Snapshot } from "./contracts";
import type { ProcessVersion } from "./linear-definition";
import { digest } from "./definition";
import { visualNodeForStep } from "./visual-definition";

/** Training remains scoped to the actual pinned workflow and authored editor step. */
export async function processTrainingContext(state: Snapshot, versions: ReadonlyMap<string, ProcessVersion>, message: string) {
  const instance = state.focusId ? state.instances[state.focusId] : Object.values(state.instances).at(-1);
  const version = instance ? versions.get(instance.versionId) : undefined;
  const memories = await loadActiveTrainingMemories(state.businessId);
  if (version?.linear) {
    const step = version.linear.steps.find(s => {
      const id = `linear_${digest(s.key).slice(0, 20)}`;
      return instance?.stepId === id || s.kind === "customer" && [1, 2, 3].some(index => instance?.stepId === `${id}_${index}`);
    });
    return selectTrainingContext(memories, version.linear.workflowId, step?.key, message);
  }
  const visual = instance && version ? { flowId: instance.definitionId, nodeId: visualNodeForStep(version, instance.stepId) } : undefined;
  return selectTrainingContext(memories, null, null, message, visual);
}
