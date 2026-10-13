import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ rpc: mocks.rpc }),
}));
vi.mock("./access", () => ({ requireActionAccess: mocks.access }));
import { parseProvisionInput, validActionBinding } from "./catalog";
import { executeWorkflowAction, renderActionMessage } from "./workflow";
import {
  provisionBusiness,
  invitationHash,
  validInvitationToken,
} from "./provision";
import { encryptSecret } from "@/lib/crypto/tokens";
import { authNext } from "@/lib/auth/next";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-actions-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agjenti.test");
  mocks.access.mockResolvedValue(undefined);
});
it("normalizes contact input and rejects missing ownership identity", () => {
  expect(
    parseProvisionInput({ name: "  Shop ", email: "OWNER@EXAMPLE.COM" }),
  ).toEqual({ name: "Shop", email: "owner@example.com", description: "" });
  expect(() =>
    parseProvisionInput({ name: "Shop", email: "not-email" }),
  ).toThrow();
  expect(
    validActionBinding({
      actionKey: "business.provision",
      actionVersion: 1,
      inputs: { name: "constructor" },
    }),
  ).toBe(false);
  expect(
    validActionBinding({
      actionKey: "business.provision",
      actionVersion: 1,
      inputs: { admin: "email" },
    }),
  ).toBe(false);
});
it("uses the persisted invitation token on retries, never the newly generated one", async () => {
  const token = "a".repeat(43);
  mocks.rpc.mockResolvedValue({
    data: {
      business_id: "created",
      token_ciphertext: encryptSecret(token),
      expires_at: "2030-01-01",
      status: "pending",
    },
    error: null,
  });
  const p = {
    businessId: "source",
    userId: "owner",
    requestId: "stable",
    input: { name: "Shop", email: "owner@example.com" },
  };
  expect((await provisionBusiness(p)).invitationUrl).toBe(
    `https://agjenti.test/join?request=${token}`,
  );
  expect((await provisionBusiness(p)).invitationUrl).toBe(
    `https://agjenti.test/join?request=${token}`,
  );
  expect(mocks.rpc.mock.calls.every((c) => c[1].p_request === "stable")).toBe(
    true,
  );
  expect(mocks.rpc.mock.calls[0][1].p_token_hash).not.toBe(
    mocks.rpc.mock.calls[1][1].p_token_hash,
  );
});
it("denied permissions and unconfirmed persistence never return a link", async () => {
  const p = {
    businessId: "source",
    userId: "staff",
    requestId: "stable",
    input: { name: "Shop", email: "owner@example.com" },
  };
  mocks.access.mockRejectedValueOnce(new Error("denied"));
  await expect(provisionBusiness(p)).rejects.toThrow("denied");
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "failed" } });
  await expect(provisionBusiness(p)).rejects.toThrow("nuk u konfirmua");
});
it("simulation does not read permissions or create real data; production requires trusted conversation context", async () => {
  const p = {
    businessId: "source",
    versionId: "version",
    nodeId: "node",
    binding: {
      actionKey: "business.provision" as const,
      actionVersion: 1 as const,
      inputs: { name: "business_name", email: "email" },
    },
    values: { business_name: "Shop", email: "owner@example.com" },
  };
  expect(
    (await executeWorkflowAction({ ...p, mode: "test" })).invitationUrl,
  ).toContain("SIMULIM");
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.access).not.toHaveBeenCalled();
  await expect(executeWorkflowAction(p)).rejects.toThrow("konteksti");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("only substitutes stored outputs and only accepts invitation auth destinations", () => {
  expect(
    renderActionMessage("Link {{actions.step.invitationUrl}}", {
      step: { invitationUrl: "/join?request=real" },
    }),
  ).toBe("Link /join?request=real");
  expect(renderActionMessage("{{actions.constructor.name}}", {})).toContain(
    "padisponueshëm",
  );
  for (const x of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/join?request=bad",
  ])
    expect(authNext(x)).toBe("/auth/continue");
  const token = "a".repeat(43);
  expect(authNext(`/join?request=${token}`)).toBe(`/join?request=${token}`);
  expect(validInvitationToken(token)).toBe(true);
  expect(invitationHash(token)).toHaveLength(64);
});
it("does not render an expired or accepted invitation as a new successful link", async () => {
  mocks.rpc.mockResolvedValue({ data: { status: "accepted" }, error: null });
  await expect(
    provisionBusiness({
      businessId: "source",
      userId: "owner",
      requestId: "retry",
      input: { name: "Shop", email: "owner@example.com" },
    }),
  ).rejects.toThrow("pranuar");
});
