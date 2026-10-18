# S1: read-only rollout preflight

This is a review procedure, not authorization to migrate an external database.
Use an explicitly approved administrative **read-only** connection: tenant RLS
can hide invalid foreign customers. Do not export customer names or contact data.

1. Verify the migration file before any rollout:
   `shasum -a 256 supabase/migrations/20261018154153_tenant_customer_integrity.sql`
   must return `1c4dcb70f488bbb69ee06de306a4413dd7291db510320220743c8c844acb7420`.
   Compare the deployment's migration history and actual catalog definitions.
   If S1 is already present, **do not reapply** or rewrite its migration history.
2. Run `tenant_customer_integrity_inventory.sql` unchanged. It is a bounded,
   read-only transaction. Any invalid relationship blocks rollout; repair needs
   a separate reviewed decision. Zero returned violations is required.
3. Review all reported keys/dependencies. The expected prior FK is the single
   customer UUID with `ON DELETE CASCADE`; the target is the immediate, validated
   composite FK `(business_id, customer_id)` referencing the unique customer pair.
   A conflicting named constraint or unexpected dependency is a blocker, not a
   reason to use `CASCADE` to drop objects. NULL customer links remain allowed.
4. Review table/index sizes and lock contention with an operator. The migration
   builds a unique index, validates the FK and needs strong table locks (including
   `ACCESS EXCLUSIVE` for ALTER operations). It can block readers/writers; use a
   low-traffic window. Its 5-second lock and 60-second statement timeouts are
   deliberate: do not disable them to force rollout. Large tables or sustained
   traffic require a separately reviewed staged migration, not an improvised run.
5. After an approved rollout, rerun this inventory: zero violations, validated
   composite FK and unique key, unchanged cascade. Check application error rates
   and PostgREST relation embeds without writing synthetic data to production.

## Failure and rollback

- The migration is transactional and performs no relationship repair. A timeout
  or validation failure must roll back the whole migration; check actual catalog
  state before retrying after an ambiguous client disconnect.
- Reverting application code does not require removing the FK. Keep database
  protection in place. Restoring the old single-column FK reopens the security
  defect and is not a safe automatic rollback.
- Any schema correction must be a new reviewed forward migration; do not edit the
  deployed file or drop the unique key while dependent constraints exist.
- Preserve a normal approved backup/recovery plan. This preflight is evidence
  for an operator decision, not proof of production readiness or a live lock test.
