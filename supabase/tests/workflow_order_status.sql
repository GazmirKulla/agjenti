begin;
do $$ declare
 graph jsonb := '{"version":2,"name":"Order status","nodes":[{"id":"start","kind":"start","label":"Start","position":{"x":0,"y":0},"config":{}},{"id":"status","kind":"order_status","label":"Statusi i porosisë","position":{"x":300,"y":0},"config":{}},{"id":"end","kind":"end","label":"End","position":{"x":600,"y":0},"config":{}}],"edges":[{"id":"start-end","source":"start","target":"end","port":"next"},{"id":"status-end","source":"status","target":"end","port":"next"}],"flows":[{"id":"status","kind":"information","label":"Statusi i porosisë","entryNodeId":"status","nodeIds":["status"]}]}';
 legacy jsonb; candidate jsonb; unsupported text;
begin
 if not valid_visual_graph(graph,false) or not valid_visual_graph(graph,true) then raise exception 'Read-only order status v2 flow rejected'; end if;
 if valid_visual_graph(jsonb_set(graph,'{version}','1'),false) or valid_visual_graph(jsonb_set(graph,'{version}','1'),true) then raise exception 'Order status allowed in v1'; end if;
 legacy:=jsonb_set(jsonb_set(graph-'flows','{version}','1'),'{nodes,1,kind}','"knowledge"');
 legacy:=jsonb_set(legacy,'{edges,0,target}','"status"');
 if not valid_visual_graph(legacy,true) then raise exception 'Legacy knowledge compatibility lost'; end if;
 candidate:=jsonb_set(graph,'{edges}',jsonb_build_array(graph#>'{edges,0}'));
 if not valid_visual_graph(candidate,false) or valid_visual_graph(candidate,true) then raise exception 'Order status next edge requirement lost'; end if;
 if valid_visual_graph(jsonb_set(graph,'{edges,1,port}','"yes"'),true) then raise exception 'Order status accepted unsupported output port'; end if;
 if valid_visual_graph(jsonb_set(graph,'{edges,1,target}','"status"'),true) then raise exception 'Order status incorrectly treated as a waiting step in cycles'; end if;
 if valid_visual_graph(jsonb_set(graph,'{flows,0,entryNodeId}','"missing"'),false) then raise exception 'Missing status flow entry accepted'; end if;
 if valid_visual_graph(jsonb_set(graph,'{flows,0,nodeIds}','["status","status"]'),false) then raise exception 'Duplicate status membership accepted'; end if;
 foreach unsupported in array array['payment','sql','webhook','http_request','order_cancel'] loop
  candidate:=jsonb_set(graph,'{nodes,1,kind}',to_jsonb(unsupported));
  if valid_visual_graph(candidate,false) or valid_visual_graph(candidate,true) then raise exception 'Arbitrary executable node accepted: %',unsupported; end if;
 end loop;
end $$;
rollback;
