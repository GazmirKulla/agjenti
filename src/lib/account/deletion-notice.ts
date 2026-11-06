export const ACCOUNT_RECOVERY_DAYS = 30;
export const ACCOUNT_SUPPORT_EMAIL = "agjentiapp@gmail.com";
/** Supabase Auth error code; bans are used only for scheduled account deletion. */
export const DELETED_ACCOUNT_CODE = "user_banned";
export const DELETED_ACCOUNT_MESSAGE = `Kjo llogari është fshirë dhe do të hiqet përfundimisht brenda ${ACCOUNT_RECOVERY_DAYS} ditëve nga kërkesa. Për ta rikthyer, na shkruaj në ${ACCOUNT_SUPPORT_EMAIL}.`;
