-- Synthetic fixtures, rolled back. This test refuses remote databases.
begin;
do $$ begin if inet_server_addr() is not null then raise exception 'local socket required'; end if; end $$;
do $$
declare b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); conn uuid:=gen_random_uuid(); other_conn uuid:=gen_random_uuid();
 conv uuid:=gen_random_uuid(); other_conv uuid:=gen_random_uuid(); m1 uuid:=gen_random_uuid(); m2 uuid:=gen_random_uuid(); m3 uuid:=gen_random_uuid();
 r messages; preview text; failed boolean;
begin
 insert into public.businesses(id,name,slug) values(b,'Changes test',b::text),(other_b,'Other test',other_b::text);
 insert into public.instagram_connections(id,business_id,ig_user_id,access_token_ciphertext,status)
  values(conn,b,'ig-'||conn,'x','connected'),(other_conn,other_b,'ig-'||other_conn,'x','connected');
 insert into public.conversations(id,business_id,channel,instagram_connection_id,instagram_participant_id,last_message_preview)
  values(conv,b,'instagram',conn,'customer-1','third'),(other_conv,other_b,'instagram',other_conn,'customer-1','other');
 insert into public.messages(id,business_id,conversation_id,instagram_connection_id,direction,source,body,media,reply_to,external_message_id,created_at)
  values(m1,b,conv,conn,'inbound','customer','first',jsonb_build_array(jsonb_build_object('kind','image')),jsonb_build_object('story',jsonb_build_object('id','s1','url','https://cdn.example/s1')),'mid-1',now()-interval '3 minutes'),
        (m2,b,conv,conn,'inbound','customer','third',null,null,'mid-2',now()-interval '1 minute');

 -- Delete of an older message: text and media go, the newer preview stays.
 perform public.record_customer_message_change(conn,'customer-1','mid-1',true,null,now());
 select * into r from messages where id=m1;
 if r.body is not null or r.media is not null or r.reply_to is not null or r.customer_deleted_at is null then raise exception 'delete not applied'; end if;
 select last_message_preview into preview from conversations where id=conv;
 if preview<>'third' then raise exception 'older delete changed preview'; end if;

 -- A later edit never restores a deleted message.
 perform public.record_customer_message_change(conn,'customer-1','mid-1',false,'restored?',now());
 if (select body from messages where id=m1) is not null then raise exception 'edit restored deleted text'; end if;

 -- Edit of the newest message updates text, marker and preview; an older edit arriving late is ignored.
 perform public.record_customer_message_change(conn,'customer-1','mid-2',false,'third, edited',now());
 perform public.record_customer_message_change(conn,'customer-1','mid-2',false,'stale',now()-interval '30 seconds');
 select * into r from messages where id=m2;
 if r.body<>'third, edited' or r.customer_edited_at is null then raise exception 'edit not applied or stale edit won'; end if;
 if (select last_message_preview from conversations where id=conv)<>'third, edited' then raise exception 'preview not updated'; end if;

 -- Another participant (or another business's connection) cannot touch the message.
 perform public.record_customer_message_change(conn,'customer-2','mid-2',true,null,now());
 if (select body from messages where id=m2)<>'third, edited' then raise exception 'foreign participant changed message'; end if;
 perform public.record_customer_message_change(other_conn,'customer-1','mid-2',true,null,now());
 if (select body from messages where id=m2)<>'third, edited' then raise exception 'foreign connection changed message'; end if;

 -- A change that arrives before the message is applied when the message is stored.
 perform public.record_customer_message_change(conn,'customer-1','mid-3',true,null,now());
 insert into public.messages(id,business_id,conversation_id,instagram_connection_id,direction,source,body,external_message_id)
  values(m3,b,conv,conn,'inbound','customer','early text','mid-3');
 select * into r from messages where id=m3;
 if r.body is not null or r.customer_deleted_at is null then raise exception 'pending delete not applied on insert'; end if;

 -- Business messages are never changed by a customer event.
 insert into public.messages(business_id,conversation_id,instagram_connection_id,direction,source,body,external_message_id,delivery_status)
  values(b,conv,conn,'outbound','staff','our reply','mid-4','sent');
 perform public.record_customer_message_change(conn,'customer-1','mid-4',true,null,now());
 if (select body from messages where external_message_id='mid-4')<>'our reply' then raise exception 'business message changed'; end if;

 -- Invalid input is refused.
 failed:=false;
 begin perform public.record_customer_message_change(conn,'customer-1','mid-1',false,null,now()); exception when others then failed:=sqlerrm='invalid_message_change'; end;
 if not failed then raise exception 'edit without text accepted'; end if;
 failed:=false;
 begin perform public.record_customer_message_change(conn,'customer-1','mid-1',true,null,now()-interval '8 days'); exception when others then failed:=sqlerrm='invalid_message_change'; end;
 if not failed then raise exception 'old event accepted'; end if;
end $$;
rollback;
