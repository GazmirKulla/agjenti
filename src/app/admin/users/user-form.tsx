"use client";

import { useRef } from "react";
import { ActionForm } from "@/components/dashboard/action-form";
import { manageUser } from "./actions";

type Business = { id: string; name: string };
export function UserForm({ action, userId, businesses = [], onSuccess }: {
  action: "create" | "password" | "verify_email" | "restore";
  userId?: string;
  businesses?: Business[];
  onSuccess?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  return <div ref={container}><ActionForm action={manageUser} className="grid gap-3" onSuccess={() => {
    container.current?.querySelector("form")?.reset();
    onSuccess?.();
  }}>
    <input type="hidden" name="action" value={action} />
    {userId && <input type="hidden" name="user_id" value={userId} />}
    {action === "create" && <>
      <label className="form-label">Emri<input className="field" name="name" required maxLength={150} autoComplete="off" /></label>
      <label className="form-label">Email<input className="field" name="email" type="email" required maxLength={254} autoComplete="off" /></label>
    </>}
    {(action === "create" || action === "password") && <>
      <label className="form-label">Fjalëkalimi i ri<input className="field" type="password" name="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>
      <label className="form-label">Përsërit fjalëkalimin<input className="field" type="password" name="password_confirm" required minLength={8} maxLength={128} autoComplete="new-password" /></label>
    </>}
    {action === "create" && <>
      <label className="toggle-label"><span>Verifiko email-in menjëherë</span><input type="checkbox" name="verified" defaultChecked /></label>
      <p className="muted-copy">Nuk dërgohet email ftese ose verifikimi. Nëse e lë të paverifikuar, mund ta verifikosh manualisht më vonë.</p>
      <label className="form-label">Biznesi (opsional)<select className="field" name="business_id" defaultValue=""><option value="">Pa biznes</option>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="form-label">Roli në biznes<select className="field" name="role" defaultValue="staff"><option value="staff">Staf</option><option value="owner">Pronar</option></select></label>
    </>}
    {action === "verify_email" && <p className="muted-copy">Konfirmon email-in direkt, pa dërguar mesazh verifikimi.</p>}
    {action === "restore" && <p className="muted-copy">Anulon fshirjen e planifikuar dhe e lejon përsëri hyrjen. Njoftimet në pajisje duhet të aktivizohen përsëri nga përdoruesi.</p>}
    <button type="submit" className="btn btn-primary">{action === "create" ? "Krijo përdorues" : action === "password" ? "Ndrysho fjalëkalimin" : action === "restore" ? "Rikthe llogarinë" : "Verifiko email-in"}</button>
  </ActionForm></div>;
}
