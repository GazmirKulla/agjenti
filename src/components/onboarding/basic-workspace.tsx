"use client";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/dashboard/action-form";
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
      className="grid gap-4"
    >
      <label className="form-label">
        Emri i biznesit
        <input
          className="field"
          name="name"
          minLength={2}
          maxLength={100}
          required
          defaultValue={initialName}
          autoComplete="organization"
          placeholder="Si quhet biznesi yt?"
        />
      </label>
      <button className="btn btn-primary" type="submit">
        Krijo hapësirën
      </button>
    </ActionForm>
  );
}
