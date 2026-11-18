-- Sa procese i përfundon Agjenti realisht: vetëm lexim, 30 ditët e fundit, bisedat reale (jo Chat Lab).
-- Ekzekutoje te Supabase → SQL Editor. Nuk ndryshon asgjë.

-- 1) A u përgjigj Agjenti? Çdo mesazh hyrës i klientit kalon nga radha e mesazheve.
--    sent = përgjigjja u dërgua · failed/uncertain = nuk u dërgua ose nuk u konfirmua · ignored = s'kishte nevojë për përgjigje
select b.name as biznesi,
       count(*) filter (where q.status = 'sent')                        as te_pergjigjura,
       count(*) filter (where q.status in ('failed','uncertain'))       as te_deshtuara,
       count(*) filter (where q.status = 'ignored')                     as pa_pergjigje,
       count(*) filter (where q.status in ('queued','processing','prepared','sending')) as ne_pritje,
       round(100.0 * count(*) filter (where q.status = 'sent')
             / nullif(count(*) filter (where q.status in ('sent','failed','uncertain')), 0), 1) as perqindja_e_pergjigjeve
from workflow_inbound_queue q
join businesses b on b.id = q.business_id
where q.operation_kind = 'inbound' and q.created_at > now() - interval '30 days'
group by b.name
order by count(*) desc;

-- 2) Proceset: çdo porosi / rezervim / status / kalim te stafi që Agjenti nisi, dhe si përfundoi.
--    Moduli dallohet nga fushat e procesit (order_*, booking_*) ose nga veprimi që ekzekutoi.
with instances as (
  select b.name as biznesi, i.value as inst
  from conversation_states s
  join businesses b on b.id = s.business_id
  cross join lateral jsonb_each(coalesce(s.collected -> 'instances', '{}'::jsonb)) i
  where s.collected ->> 'schemaVersion' = '4' and s.collected ->> 'mode' = 'live'
    and s.updated_at > now() - interval '30 days'
), classified as (
  select biznesi, inst ->> 'status' as statusi,
    case
      when exists (select 1 from jsonb_each(coalesce(inst -> 'results', '{}')) r where r.value ->> 'tool' = 'orders.status') then 'statusi_i_porosise'
      when exists (select 1 from jsonb_object_keys(coalesce(inst -> 'facts', '{}')) k where k like 'booking\_%') then 'rezervim'
      when exists (select 1 from jsonb_object_keys(coalesce(inst -> 'facts', '{}')) k where k like 'order\_%') then 'porosi'
      when inst ->> 'status' = 'handoff' then 'kalim_te_stafi'
      else 'tjeter'
    end as moduli,
    exists (select 1 from jsonb_each(coalesce(inst -> 'results', '{}')) r where r.value ->> 'status' = 'succeeded') as veprimi_u_krye
  from instances
)
select moduli,
       count(*)                                                        as te_nisura,
       count(*) filter (where statusi = 'completed' and veprimi_u_krye) as te_kryera_me_veprim,
       count(*) filter (where statusi = 'completed')                    as te_mbyllura,
       count(*) filter (where statusi = 'handoff')                      as te_kaluara_stafit,
       count(*) filter (where statusi in ('cancelled'))                 as te_anuluara_nga_klienti,
       count(*) filter (where statusi = 'failed')                       as te_deshtuara,
       count(*) filter (where statusi like 'waiting%' or statusi in ('running','suspended')) as te_pambaruara,
       round(100.0 * count(*) filter (where statusi = 'completed') / nullif(count(*), 0), 1) as perqindja_e_perfundimit
from classified
group by moduli
order by te_nisura desc;

-- 3) Porositë që Agjenti i çoi deri në fund dhe çfarë ndodhi me to.
select b.name as biznesi,
       count(*)                                              as porosi_nga_agjenti,
       count(*) filter (where s.status in ('accepted','local_only')) as te_pranuara,
       count(*) filter (where s.status = 'rejected')         as te_refuzuara,
       count(*) filter (where s.status = 'pending_reconciliation') as per_verifikim
from order_submissions s
join businesses b on b.id = s.business_id
where s.executor_kind = 'customer_agent' and s.created_at > now() - interval '30 days'
group by b.name;

-- 4) Porositë që Agjenti i përgatiti, por presin stafin (pa u krijuar ende).
select b.name as biznesi, count(*) as ne_pritje_te_stafit
from process_order_reviews r
join businesses b on b.id = r.business_id
where r.created_at > now() - interval '30 days'
group by b.name;
