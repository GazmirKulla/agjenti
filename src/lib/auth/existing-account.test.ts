import { expect, it } from "vitest";
import { isExistingAccount } from "./existing-account";

it("recognises a sign-up for an email that already has an account", () => {
  // Email confirmation on: a user without identities, no session, no error.
  expect(isExistingAccount({ data: { user: { identities: [] } }, error: null })).toBe(true);
  // Email confirmation off.
  expect(isExistingAccount({ data: { user: null }, error: { code: "user_already_exists" } })).toBe(true);
  // A new account, or one that still waits for its confirmation email.
  expect(isExistingAccount({ data: { user: { identities: [{ provider: "email" }] } }, error: null })).toBe(false);
  expect(isExistingAccount({ data: { user: null }, error: { code: "weak_password" } })).toBe(false);
  expect(isExistingAccount({ data: { user: { identities: null } }, error: null })).toBe(false);
});
