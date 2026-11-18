# Aftësitë e Agjentit

Raporti që tregon, për çdo modul, çfarë di të bëjë agjenti i klientit (Instagram, WhatsApp) dhe agjenti i biznesit (Asistenti), me përqindje dhe problemet kryesore.

- Faqja e publikuar: https://claude.ai/artifact/R1QSyDSpuv1uDnrQG1U58K (private; ndahet nga menuja Share)
- Të dhënat dhe gjeneruesi: `build.py`
- Pamja: `page.tpl.html`
- Faqja e gjeneruar: `aftesite-e-agjentit.html`
- Matja reale nga prodhimi (vetëm lexim): `matja-e-proceseve.sql`

## Kur përditësohet

Sa herë që një ndryshim në kod shton, heq ose kufizon një aftësi të agjentit të klientit ose të Asistentit (një modul, një veprim, një operacion i Asistentit, një kusht si workflow-i), në të njëjtin ndryshim:

1. Ndrysho aftësinë përkatëse te `build.py`: `po` (funksionon), `pjes` (vetëm me konfigurim ose pjesërisht), `jo` (nuk ekziston).
2. Përditëso datën në krye dhe në fund të `page.tpl.html`, dhe seksionet "Gjendja reale sot" dhe "Problemet kryesore" nëse ndryshuan.
3. Gjenero faqen: `python3 docs/aftesite-e-agjentit/build.py`
4. Ripubliko te i njëjti link (Artifact me `url` të mësipërm), që linku të mbetet i njëjti.

Edhe kur një gjetje (provë live, review, test) tregon se një aftësi punon më keq se ç'shkruhet, ule vlerësimin e saj (`po` → `pjes` → `jo`) ose shto aftësinë që mungon, dhe shkruaje te "Problemet kryesore". Raporti mban gjendjen reale, jo atë të synuar.

Vlerësimi bëhet nga leximi i kodit. Për përqindjet reale nga bisedat, ekzekuto `matja-e-proceseve.sql` te Supabase → SQL Editor.
