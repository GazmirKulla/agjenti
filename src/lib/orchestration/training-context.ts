import { loadActiveTrainingMemories } from "@/lib/agents/training/load";
import { selectTrainingContext, type TrainingMemory } from "@/lib/agents/training/model";
import type { Snapshot } from "./contracts";
import type { ProcessVersion } from "./linear-definition";
import { digest } from "./definition";
import { visualNodeForStep } from "./visual-definition";
import { productStepSource } from "./product-composition";

/** Training remains scoped to the actual pinned workflow and authored editor step. */
export async function processTrainingContext(state: Snapshot, versions: ReadonlyMap<string, ProcessVersion>, message: string, preview?: TrainingMemory[]) {
  const instance = state.focusId ? state.instances[state.focusId] : Object.values(state.instances).at(-1);
  const version = instance ? versions.get(instance.versionId) : undefined;
  // A training test adds the proposed examples (newest first) to the approved ones.
  const memories = [...(preview ?? []), ...await loadActiveTrainingMemories(state.businessId)];
  const dependency = instance?.productWorkflow?.versionId ? versions.get(instance.productWorkflow.versionId) : undefined;
  const productStep = version && dependency && instance ? productStepSource(version, dependency, instance.stepId) : undefined;
  if (productStep && dependency?.linear) {
    const [parent, child] = await Promise.all([
      selectTrainingContext(memories, null, null, message, { flowId: instance!.definitionId, nodeId: productStep.nodeId }),
      selectTrainingContext(memories, dependency.linear.workflowId, productStep.stepKey, message),
    ]);
    return { rules: [...new Map([...child.rules, ...parent.rules].map(rule => [rule.id, rule])).values()] };
  }
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
