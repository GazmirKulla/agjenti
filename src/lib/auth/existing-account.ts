/** A sign-up for an email that already has an account. While email
 * confirmation is on, Supabase answers it with a user without identities and
 * sends no email; with confirmation off it fails with user_already_exists. */
export function isExistingAccount(result: {
  data?: { user?: { identities?: unknown[] | null } | null } | null;
  error?: { code?: string } | null;
}) {
  if (result.error) return result.error.code === "user_already_exists" || result.error.code === "email_exists";
  const identities = result.data?.user?.identities;
  return !!result.data?.user && Array.isArray(identities) && identities.length === 0;
}

export const EXISTING_ACCOUNT_MESSAGE =
  "Ky email ka tashmë një llogari. Shkruaj fjalëkalimin për të hyrë. Nëse u regjistrove me Google, vazhdo me Google.";
