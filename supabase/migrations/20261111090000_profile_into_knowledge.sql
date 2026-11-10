-- The business profile moves into Knowledge: what each owner told us during
-- onboarding becomes one knowledge entry per topic, read by the agent and
-- edited like any other entry. Topics that already have an entry are skipped.
begin;

with topics(field, title) as (values
  ('businessDescription','Përshkrimi i biznesit'),
  ('categoryDescription','Çfarë bën biznesi'),
  ('offeringsSummary','Çfarë ofron biznesi'),
  ('catalogContext','Si përdoren katalogët'),
  ('customerQuestions','Pyetjet e shpeshta'),
  ('customerProcess','Si bëhet porosia ose rezervimi')
), answers as (
  select o.business_id, t.field, t.title,
    case when jsonb_typeof(o.answers->'details'->t.field)='array'
      then (select string_agg('• '||btrim(item),E'\n') from jsonb_array_elements_text(o.answers->'details'->t.field) item where btrim(item)<>'')
      when jsonb_typeof(o.answers->'details'->t.field)='string' then btrim(o.answers->'details'->>t.field) end as body
  from business_onboarding o cross join topics t
  where o.business_id is not null and exists(select 1 from businesses b where b.id=o.business_id)
)
insert into knowledge_entries(business_id,title,body,intent_key,is_active)
select a.business_id, a.title, left(a.body,8000), 'profile:'||a.field, true from answers a
where coalesce(a.body,'')<>''
  and not exists(select 1 from knowledge_entries k where k.business_id=a.business_id and k.intent_key='profile:'||a.field);

commit;
