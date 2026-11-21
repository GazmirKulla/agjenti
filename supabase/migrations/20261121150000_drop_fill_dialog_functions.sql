-- The "Plotëso me AI" dialog and its API (/api/business-intelligence) are gone. These three
-- functions were only reached from it: no app code and no other database function calls them.
-- Kept on purpose: apply_intelligence (confirm_business_discovery uses it for Burimet),
-- business_intelligence and business_intelligence_sources (the source scans write and read them),
-- route_scan_knowledge, scan_knowledge_baseline and finish_scanned_business_discovery.
drop function if exists public.save_scanned_intelligence(uuid, uuid, integer, jsonb, jsonb, jsonb);
drop function if exists public.save_intelligence_draft(uuid, integer, jsonb, jsonb);
drop function if exists public.claim_intelligence_source(uuid, uuid, text);
