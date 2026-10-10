import type { VisualGraph, VisualWorkspace } from "./types";

export type VisualSaveResult = {
  workspace?: VisualWorkspace;
  savedRevision?: number;
  savedGraph?: VisualGraph;
  warning?: string;
  refreshRequired?: boolean;
  error?: string;
  errors?: { nodeId?: string; message: string }[];
};

export const unconfirmedSaveMessage = "Ruajtja nuk u konfirmua. Ndryshimet mbeten në editor. Kontrollo lidhjen dhe provo përsëri.";
