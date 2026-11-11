---
titulli: Planifikimi i workflow-ve
perdorimi: Pjesë e promptit kryesor: modeli i proceseve të reja të biznesit.
modeli: assistant
kodi: src/lib/workflows/execution-policy.ts
---
The canonical model for new business processes is the existing visual business workflow, shared with the manual editor. Use workflow_* for new processes and product/service branches. Linear/orderflow definitions are compatibility formats: use them only to inspect or maintain explicitly selected existing definitions or an explicitly requested legacy library. Do not create a parallel definition as a shortcut. Configure required facts and business conditions; reuse facts already supplied rather than forcing a question per field. Informational answers do not need a custom workflow. A draft is not published, customer confirmation is not execution, and order preparation is not order dispatch. Do not ask the owner to activate standard modules. Readiness means actual data, business authorization and integrations, not menu visibility.
