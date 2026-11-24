import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DataChart } from "@/components/charts/data-chart";
import { AssistantMessageBody } from "@/components/business-assistant/message-blocks";
import { blockReply, parseBlocks } from "@/lib/business-assistant/blocks";
import { readChart, type ChartData } from "./model";
const chart: ChartData = { title: "Porosi", kind: "line", timezone: "Europe/Tirane", categories: [{key:"a",label:"01.11"},{key:"b",label:"02.11"},{key:"c",label:"03.11"}], series: [{key:"orders",label:"Porosi",values:[0,null,4]}] };
it("retains server values through stored blocks and uses the shared renderer without duplicating fallback text", () => {
 const reply = blockReply("Ecuria e porosive", [{type:"chart",version:1,chart}]);
 const stored = parseBlocks(JSON.parse(JSON.stringify(reply.blocks)));
 const html = renderToStaticMarkup(createElement(AssistantMessageBody,{content:reply.message,blocks:stored,slug:"test"}));
 expect(html).toContain('class="data-chart"'); expect(html).toContain("E padisponueshme");
 expect(html.match(/<svg/g)).toHaveLength(1); expect(html).toContain("<td>0</td>"); expect(html).toContain("<td>4</td>");
 expect(reply.message).toContain("02.11: Porosi e padisponueshme");
 expect(html).toContain('d="M'); expect(html).not.toMatch(/d="M[^\"]*L/); // gap is not connected
 expect(renderToStaticMarkup(createElement(AssistantMessageBody,{content:reply.message,blocks:[],slug:"test"}))).toContain("03.11: Porosi 4");
});
it.each([NaN, Infinity, -1, "3"])("rejects invalid numeric data %s", value => {
 expect(readChart({...chart,series:[{...chart.series[0],values:[0,value,4]}]})).toBeNull();
});
it("rejects mismatched lengths, duplicate keys, excessive series and markup-like chart types", () => {
 for(const invalid of [{...chart,kind:"<script>"},{...chart,categories:[chart.categories[0],chart.categories[0]]},
 {...chart,series:[{...chart.series[0],values:[1]}]}, {...chart,series:Array(7).fill(chart.series[0])}]) expect(readChart(invalid)).toBeNull();
});
it("distinguishes no observations, zeros and unavailable readings", () => {
 const render=(data:ChartData)=>renderToStaticMarkup(createElement(DataChart,{data}));
 expect(render({...chart,categories:[],series:[{...chart.series[0],values:[]}]})).toContain("Asnjë e dhënë");
 expect(render({...chart,series:[{...chart.series[0],values:[0,0,0]}]})).toContain("Asnjë aktivitet");
 expect(render({...chart,series:[{...chart.series[0],values:[null,null,null]}]})).toContain("Të dhënat nuk disponohen");
 expect(renderToStaticMarkup(createElement(DataChart,{data:chart,compact:true}))).not.toContain('<button');
});
