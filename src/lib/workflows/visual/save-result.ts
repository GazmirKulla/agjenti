import type { VisualGraph, VisualWorkspace } from "./types";
import type { PublicationReadiness, PublicationReceipt } from "./publication-types";

export type VisualSaveResult = {
  publication?: PublicationReadiness;
  receipt?: PublicationReceipt;
  workspace?: VisualWorkspace;
  savedRevision?: number;
  savedGraph?: VisualGraph;
  warning?: string;
  refreshRequired?: boolean;
  error?: string;
  errors?: { nodeId?: string; message: string }[];
};

export const unconfirmedSaveMessage = "Ruajtja nuk u konfirmua. Ndryshimet mbeten në editor. Kontrollo lidhjen dhe provo përsëri.";
