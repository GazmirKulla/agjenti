import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => mocks }));
import { sealImportSource, prepareImport, commitImport, openImportToken } from "./import-service";
const access = { userId: "user", businessId: "business", catalogSource: "internal", modules: ["products"] };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-csv-key"); });
it("binds sources to tenant/user, expiry and module before any database access", async () => {
  const source = sealImportSource(access, 'emri,sku,cmimi\nI ri,NEW,790', "test.csv");
  for (const other of [{...access, userId:"other"}, {...access, businessId:"other"}, {...access, catalogSource:"external"}, {...access, modules:[]}]) {
    await expect(prepareImport(other, source.token, { mapping: source.mapping, fields:["name"] })).rejects.toThrow();
  }
  expect(() => openImportToken(source.token + "x", access, "product-import-source")).toThrow();
  vi.spyOn(Date,"now").mockReturnValue(Date.now()+3600001);
  expect(() => openImportToken(source.token, access, "product-import-source")).toThrow();
  vi.restoreAllMocks();
  expect(mocks.from).not.toHaveBeenCalled();
});
it("reads all catalog pages within the tenant and submits only the reviewed signed changes", async () => {
  const queries: unknown[][] = [];
  let page = 0;
  mocks.from.mockImplementation(() => {
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn((...args) => { queries.push(args); return chain; }), order: vi.fn().mockReturnThis(), range: vi.fn(async () => ({ data: page++ === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, sku: `SKU-${i}`, name: `Produit ${i}` })) : [], error:null })) };
    return chain;
  });
  const source = sealImportSource(access, 'emri,sku,cmimi\nI ri,NEW,790', "test.csv");
  const preview = await prepareImport(access, source.token, {mapping:source.mapping,fields:["name","sku","price_amount"]});
  expect(queries).toEqual([["business_id","business"],["business_id","business"]]);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({data:1,error:null});
  expect(await commitImport(access,preview.token!)).toHaveProperty("success");
  const args = mocks.rpc.mock.calls[0][1];
  expect(args).toMatchObject({p_business:"business",p_user:"user",p_rows:[{patch:{name:"I ri",sku:"NEW",price_amount:790,currency:"ALL"}}]});
  await commitImport(access,preview.token!);
  expect(mocks.rpc.mock.calls[1][1]).toEqual(args);
});
it("does not issue an approval when any selected row conflicts", async () => {
  const chain = {select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn().mockResolvedValue({data:[],error:null})};
  mocks.from.mockReturnValue(chain);
  const source = sealImportSource(access,'emri,cmimi\nValid,10\nInvalid,abc',"test.csv");
  const preview = await prepareImport(access,source.token,{mapping:source.mapping,fields:["name","price_amount"]});
  expect(preview.token).toBeUndefined();
  expect(preview.rows).toHaveLength(2);
});
