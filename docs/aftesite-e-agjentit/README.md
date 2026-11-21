# Aftësitë e Agjentit

Raporti që tregon, për çdo modul, çfarë di të bëjë agjenti i klientit (Instagram, WhatsApp) dhe agjenti i biznesit (Asistenti), me përqindje dhe problemet kryesore, ndodhet tani brenda panelit:

- Faqja: Platform Admin → Shëndeti i Agjentit → Aftësitë e Agjentit (`/admin/health/aftesite`)
- Të dhënat dhe vlerësimet: `src/lib/agent-report/capabilities.ts` (udhëzimet për përditësim në krye të skedarit)
- Matja reale nga prodhimi (vetëm lexim): `matja-e-proceseve.sql`, ekzekutohet te Supabase → SQL Editor

Versioni i vjetër HTML (i gjeneruar nga `build.py` dhe i publikuar si Artifact) nuk mbahet më.
