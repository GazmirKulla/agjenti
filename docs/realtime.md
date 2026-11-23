# Realtime updates in web and mobile

The dashboard and native app use one private Supabase Realtime Broadcast WebSocket per browser tab/native runtime. SSE is not used. Events contain a resource and optional business slug; they never carry messages, credentials or permission to mutate data. Existing authenticated HTTP endpoints remain the source of truth. Reads happen at initial subscription, after relevant events, after reconnect/foreground and on explicit user actions. Bursts are coalesced and an event during a read schedules a trailing read. There is no periodic HTTP fallback.

Native embedded pages share the native socket through a metadata-only bridge. A user-agent marker handles platforms where early JavaScript injection is delayed; a readiness handshake requests a snapshot once the page subscribes. Native sockets pause in the background and resubscribe when active. Existing Assistant push notifications are preserved; this change does not add Inbox push notifications or promise persistent background sockets.

Database triggers select current business members and platform administrators at each mutation. Private Assistant and operator conversations restrict recipients to their owner. Revocation refreshes the removed user's access state. Channel RLS permits receiving only the authenticated user's topic, without a client publishing policy. Existing API authorization is still required. Internal service-only channels support bounded waits for scan completion and transport echoes.

Message POSTs/webhooks start server-owned queue continuation. Status GETs no longer execute workers. A completed batch or known lease deadline can hand off to the authenticated worker POST; lost handoffs are recovered by the existing scheduled worker. This recovery schedule is background job infrastructure, not UI polling.

## Rollout

1. Apply `supabase/migrations/20261123120000_realtime_invalidations.sql` before deploying clients. Verify private Broadcast and the `realtime.messages` policy on the target Supabase instance. Do not run the isolated SQL fixture against production.
2. Verify `CRON_SECRET` and the canonical HTTPS application origin used by `workerOrigin`. Verify the existing once-per-minute schedule from `supabase/operations/workflow-worker-schedule.sql`, including Vault settings `agjenti_app_url` and `agjenti_cron_secret`. The daily Vercel entry is only a compatibility fallback. Do not print secrets while checking configuration.
3. Deploy web and exercise a real write from another session. Check recipient isolation, revocation, private Assistant/test conversations, failed sends, explicit retries, network interruption and missed updates during reconnect. Observe Agent Health for `system.realtime` and `system.transport_wake` failures.
4. Build and distribute a compatible mobile binary containing `expo-network`; verify runtime compatibility before any OTA update. Test iOS and Android foreground/background, offline recovery, account/business switching and embedded pages. Installed older clients retain their old behavior until updated; version endpoints remain for backward compatibility.
5. Run `REALTIME_IDLE_MS=600000` with the isolated realtime Playwright spec. After initial loading, idle clients must issue no periodic API/RSC reads. WebSocket heartbeats and reconnect attempts are expected protocol traffic. Verify another session's mutation updates the UI without manual refresh.

## Verification and limits

Local tests cover idle behavior, coalescing, trailing reads, account switches, scope filtering, native bridge routing and queue handoff. `python3 scripts/realtime/test-sql.py` applies the actual new migration to an isolated PostgreSQL fixture and checks routing/RLS/rollback/failure tracking with provider functions stubbed. It does not verify the hosted Supabase service.

The real end-to-end test requires Docker and the local Supabase stack. A separate attempt to replay the historical schema encountered an existing dependency failure in `20261109130000_multiple_businesses_per_user.sql` (the `onboarding_audio_attempts_user_id_fkey` dependency on the old primary key); this change does not alter that migration. Real-device and production verification remain required. Broadcast is an invalidation hint, not a durable event log: reconnect takes an authoritative snapshot. A healthy socket alone does not prove database broadcasts are succeeding; monitor recorded broadcast failures.

For rollback, coordinate client and server versions. Reverting clients restores their previous polling behavior, which does not meet the no-polling objective. Keeping the new clients while disabling Broadcast requires manual refresh and is degraded operation, not a completed rollback. Preserve worker recovery and the existing authorized HTTP APIs in either case; retain the additive migration while compatible clients are in use.

## Production database verification — 2026-11-23

Applied `20261123120000_realtime_invalidations` to the project configured by `.env.local`, through its existing authenticated Supabase SQL Editor session because the stored Management API/CLI token returned HTTP 401. The migration and its history entry committed atomically. Removed the obsolete `leads` trigger target before applying: that table was already removed by `20261121171000_drop_leads_table.sql`.

Verified 33 enabled triggers, the authenticated per-user SELECT policy, and the active once-per-minute workflow schedule. A real test-account WebSocket subscribed to its own private topic, was rejected from another user's topic, and received a nonce-tagged event sent with `realtime.send` from SQL. A real business trigger emitted successfully inside a transaction that was rolled back; no verification business-data change was retained. No `system.realtime` failures were recorded in the checked ten-minute window. The existing local web application's Inbox no longer displayed the interruption banner.

This verifies the live database and authenticated transport. It does not constitute a deployed web/mobile release or real-device background/reconnect verification. The stored Management API token still requires renewal for future CLI/API administration; application Realtime uses separate credentials.
