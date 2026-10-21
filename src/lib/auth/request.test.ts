import { describe, it, expect, vi } from 'vitest';
const { getUser, cookieUser } = vi.hoisted(() => ({ getUser: vi.fn(), cookieUser: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser } }) }));
vi.mock('@/lib/tenant/access', () => ({ getSessionUser: cookieUser }));
import { getRequestUser, permittedWrite } from './request';
const request = (headers: Record<string,string>) => new Request('https://agjenti.app/api/business-assistant', { method: 'POST', headers });
describe('native authentication boundary', () => {
  it('retains cookie CSRF protection and rejects foreign origins even with bearer', () => {
    expect(permittedWrite(request({}))).toBe(false);
    expect(permittedWrite(request({ origin: 'https://evil.example' }))).toBe(false);
    expect(permittedWrite(request({ origin: 'https://agjenti.app' }))).toBe(true);
    expect(permittedWrite(request({ authorization: 'Bearer abc.def.ghi' }))).toBe(true);
    expect(permittedWrite(request({ authorization: 'Bearer abc.def.ghi', origin: 'https://evil.example' }))).toBe(false);
    expect(permittedWrite(request({ authorization: 'Bearer abc.def.ghi', 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });
  it('never falls back to cookies on a malformed or revoked bearer', async () => {
    cookieUser.mockClear(); getUser.mockResolvedValue({ data: { user: null }, error: new Error('revoked') });
    expect(await getRequestUser(request({ authorization: 'Basic x' }))).toBeNull();
    expect(await getRequestUser(request({ authorization: 'Bearer revoked' }))).toBeNull();
    expect(cookieUser).not.toHaveBeenCalled();
  });
  it('uses server verified user instead of any client supplied identity', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'verified' } }, error: null });
    expect(await getRequestUser(request({ authorization: 'Bearer valid', 'x-user-id': 'forged' }))).toEqual({ id: 'verified' });
  });
});
