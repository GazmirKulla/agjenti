-- Staff photos to the customer (20261116090000_staff_media_messages.sql). Disposable database only; rolls back.
begin;
do $$
declare b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); conn uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 result jsonb; j workflow_inbound_queue; req uuid; m messages;
begin
 insert into auth.users(id,email) values(u,'media@test.invalid');
 insert into businesses(id,name,slug) values(b,'Media test','media-test');
 insert into business_users(business_id,user_id,role) values(b,u,'owner');
 insert into instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status) values(conn,b,'media-test','test','connected');
 insert into conversations(id,business_id,channel,instagram_connection_id,instagram_participant_id,last_inbound_at) values(c,b,'instagram',conn,'person',now());

 -- A photo with a caption: the job keeps the photo in its payload and the caption as its reply.
 req:=gen_random_uuid();
 result:=enqueue_transport_operation(b,u,req,'staff',c,null,repeat('b',64),'{"body":"  Ja si do dalë  ","media":{"kind":"image","url":"https://store.test/p.jpg","extra":"x"}}');
 select * into j from workflow_inbound_queue where id=(result->>'id')::bigint;
 if j.reply<>'Ja si do dalë' or j.payload->'media'<>'{"kind":"image","url":"https://store.test/p.jpg"}'::jsonb or j.status<>'prepared' then raise exception 'photo job %',to_jsonb(j); end if;
 if (enqueue_transport_operation(b,u,req,'staff',c,null,repeat('b',64),'{"body":"Ja si do dalë","media":{"kind":"image","url":"https://store.test/p.jpg"}}')->>'id')::bigint<>j.id then raise exception 'duplicate photo job'; end if;

 -- Sent: the message carries the photo; a photo without a caption previews as "Foto".
 update workflow_inbound_queue set lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes' where id=j.id returning * into j;
 if not begin_workflow_send(j.id,j.lease_token) then raise exception 'send rejected'; end if;
 perform finish_workflow_send(j.id,j.lease_token,true,'mid.photo.1',null);
 select * into m from messages where conversation_id=c and external_message_id='mid.photo.1';
 if m.body<>'Ja si do dalë' or m.media<>'[{"kind":"image","sourceUrl":"https://store.test/p.jpg","caption":"Ja si do dalë"}]'::jsonb or m.direction<>'outbound' then raise exception 'message %',to_jsonb(m); end if;
 update conversations set last_inbound_at=now() where id=c;
 result:=enqueue_transport_operation(b,u,gen_random_uuid(),'staff',c,null,repeat('c',64),'{"media":{"kind":"image","url":"https://store.test/q.jpg"}}');
 select * into j from workflow_inbound_queue where id=(result->>'id')::bigint;
 if j.reply is not null then raise exception 'empty caption kept'; end if;
 update workflow_inbound_queue set lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes' where id=j.id returning * into j;
 perform begin_workflow_send(j.id,j.lease_token);
 perform finish_workflow_send(j.id,j.lease_token,true,'mid.photo.2',null);
 if (select last_message_preview from conversations where id=c)<>'Foto' then raise exception 'preview'; end if;

 -- Refused: text-less without a photo, a photo that is not https or not an image, a caption over 1000 characters.
 begin perform enqueue_transport_operation(b,u,gen_random_uuid(),'staff',c,null,repeat('d',64),'{"body":"   "}'); raise exception 'empty text accepted';
 exception when others then if sqlerrm<>'transport_invalid' then raise; end if; end;
 begin perform enqueue_transport_operation(b,u,gen_random_uuid(),'staff',c,null,repeat('d',64),'{"media":{"kind":"image","url":"http://store.test/p.jpg"}}'); raise exception 'http accepted';
 exception when others then if sqlerrm<>'transport_invalid' then raise; end if; end;
 begin perform enqueue_transport_operation(b,u,gen_random_uuid(),'staff',c,null,repeat('d',64),'{"media":{"kind":"video","url":"https://store.test/p.mp4"}}'); raise exception 'video accepted';
 exception when others then if sqlerrm<>'transport_invalid' then raise; end if; end;
 begin perform enqueue_transport_operation(b,u,gen_random_uuid(),'staff',c,null,repeat('d',64),jsonb_build_object('body',repeat('x',1001),'media',jsonb_build_object('kind','image','url','https://store.test/p.jpg'))); raise exception 'long caption accepted';
 exception when others then if sqlerrm<>'transport_invalid' then raise; end if; end;
 -- Text alone still works as before.
 perform enqueue_transport_operation(b,u,gen_random_uuid(),'staff',c,null,repeat('e',64),'{"body":"Faleminderit"}');
end $$;
select 'staff_media_messages ok';
rollback;
