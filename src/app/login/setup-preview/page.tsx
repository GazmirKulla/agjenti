import { SetupJourney } from "@/components/setup/journey";
import { ActionForm } from "@/components/dashboard/action-form";
export default async function Preview({searchParams}:{searchParams:Promise<{ready?:string}>}) {
 const ready = (await searchParams).ready === "1";
 return <main style={{ maxWidth: 1120, margin: "30px auto", padding: "0 16px" }}>
 <SetupJourney slug="demo" status={{ available:true, connected:ready, productCount:ready?1:0, usableProducts:ready?1:0, unconfiguredProducts:0, agentReady:ready, tested:ready, signature:"demo", launched:false }} />
 <ActionForm action={async (form) => { "use server"; return { success: `Zgjedhja: ${form.get("mode")}` }; }}><button type="submit" name="mode" value="manual">Kontrollo mënyrën manuale</button></ActionForm>
 </main>;
}
