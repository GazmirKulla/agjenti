import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  permitted: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/auth/request", () => ({
  getRequestUser: mocks.user,
  permittedWrite: mocks.permitted,
}));
vi.mock("@/lib/onboarding/starter", () => ({
  createStarterWorkspace: mocks.create,
}));
import { POST } from "./route";

const req = (body: unknown) =>
  new Request("https://app.test/api/mobile/businesses", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "owner" });
  mocks.permitted.mockReturnValue(true);
  mocks.create.mockResolvedValue({ ok: true });
});

it("does not allow cookie requests without CSRF checks", async () => {
  mocks.permitted.mockReturnValue(false);
  expect((await POST(req({ name: "Studio", businessType: "retail" }))).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("rejects unauthenticated requests", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await POST(req({ name: "Studio", businessType: "retail" }))).status).toBe(401);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("creates the workspace for the verified user and ignores a spoofed owner", async () => {
  const response = await POST(
    req({ name: "Studio", businessType: "retail", user_id: "victim" }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(mocks.create).toHaveBeenCalledWith("owner", {
    name: "Studio",
    businessType: "retail",
    user_id: "victim",
  });
});

it("asks the client to refresh when a workspace already exists", async () => {
  mocks.create.mockResolvedValue({
    error: "Ke tashmë një hapësirë.",
    status: 409,
  });
  expect(
    (await POST(req({ name: "Studio", businessType: "retail" }))).status,
  ).toBe(409);
});

it("returns validation failures without creating a workspace", async () => {
  mocks.create.mockResolvedValue({
    error: "Zgjidh llojin e biznesit.",
    status: 400,
  });
  expect((await POST(req({ name: "Studio" }))).status).toBe(400);
});
