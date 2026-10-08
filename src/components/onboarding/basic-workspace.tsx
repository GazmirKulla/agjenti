"use client";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/dashboard/action-form";
import { Icon } from "@/components/dashboard/icon";
import { createBasicWorkspace } from "@/lib/onboarding/actions";
export function BasicWorkspaceForm({ initialName = "" }: { initialName?: string }) {
  const router = useRouter();
  return (
    <ActionForm
      action={async (form) => {
        const result = await createBasicWorkspace(form);
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
        <div className="onboarding-note">
          <Icon name="spark" />
          <p>
            Do të krijojmë hapësirën tënde dhe një agjent me udhëzime
            fillestare. Ti vendos kur të aktivizosh përgjigjet automatike.
          </p>
        </div>
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
