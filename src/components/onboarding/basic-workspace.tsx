"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/dashboard/action-form";
import { Icon } from "@/components/dashboard/icon";
import { createAgentWorkspace } from "@/lib/onboarding/actions";
import { businessCategories } from "@/lib/onboarding/categories";

/** Agent mode: name and business type, then straight into the dashboard where
 * the agent asks the remaining questions. */
export function AgentWorkspaceForm({ initialName = "", initialType = "" }: { initialName?: string; initialType?: string }) {
  const router = useRouter();
  const [type, setType] = useState(
    businessCategories.some(([id]) => id === initialType) ? initialType : "",
  );
  return (
    <ActionForm
      action={async (form) => {
        const result = await createAgentWorkspace(form);
        if (result.destination) {
          router.replace(result.destination);
          router.refresh();
          return { success: "Hapësira u krijua. Duke hapur panelin…" };
        }
        return { error: result.error || "Hapësira nuk u krijua." };
      }}
      className="onboarding-workspace-form"
    >
      <div className="onboarding-intro">
        <label htmlFor="workspace-name">Emri i biznesit</label>
        <input
          id="workspace-name"
          name="name"
          minLength={2}
          maxLength={100}
          required
          defaultValue={initialName}
          autoComplete="organization"
          placeholder="Si quhet biznesi yt?"
        />
      </div>
      <div className="onboarding-intro">
        <label htmlFor="workspace-type">Tipi i biznesit</label>
        <select
          id="workspace-type"
          name="businessType"
          required
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="" disabled>Zgjidh tipin e biznesit</option>
          {businessCategories.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>
      {type === "other" && (
        <div className="onboarding-intro">
          <label htmlFor="workspace-description">Përshkruaje shkurt biznesin</label>
          <input
            id="workspace-description"
            name="categoryDescription"
            minLength={2}
            maxLength={500}
            required
            placeholder="P.sh. punishte qeramike me porosi"
          />
        </div>
      )}
      <div className="onboarding-intro">
        <label htmlFor="workspace-instagram">Instagram i biznesit <small>(opsional)</small></label>
        <input
          id="workspace-instagram"
          name="instagramUsername"
          maxLength={80}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="@dyqani.im"
        />
        <small className="onboarding-hint">Asistenti mëson nga profili dhe postimet publike. Mund ta shtosh edhe më vonë te Njohuritë.</small>
      </div>
      <div className="onboarding-note">
        <Icon name="spark" />
        <p>
          Pasi të krijohet hapësira, Asistenti në panel të bën disa pyetje për ta
          përshtatur me biznesin tënd. Ti vendos kur të aktivizosh përgjigjet
          automatike.
        </p>
      </div>
      <div className="onboarding-actions">
        <div className="onboarding-actions-end">
          <button className="onboarding-next" type="submit">
            Krijo hapësirën →
          </button>
        </div>
      </div>
    </ActionForm>
  );
}
