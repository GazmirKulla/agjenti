import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { fetchPublicPage } from "@/lib/products/import-url";
const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList(); globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["2001::",23],["2001:db8::",32],["2002::",16],["3fff::",20]] as const) blocked.addSubnet(address, prefix, "ipv6");
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
async function resolvePublic(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const records = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
    lookup(host, { all: true }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS timeout")), 3000); }),
  ]).finally(() => clearTimeout(timer));
  if (!records.length || records.some(record => !isPublicAddress(record.address))) throw new Error("Private address");
  return records;
}
// Pin the validated address to the actual socket. A second DNS resolution must
// never silently replace the address checked by the public-page reader.
const pinnedFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid URL");
  const addresses = await resolvePublic(url.hostname);
  if (init?.signal?.aborted) throw new Error("Request aborted");
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET", signal: init?.signal ?? undefined,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      lookup: (_host, options, callback) => {
        const address = addresses[0];
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, response => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const status = response.statusCode ?? 502;
      const body = ([204,205,304].includes(status) || (status >= 300 && status < 400)) ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>;
      if (!body) response.destroy();
      resolve(new Response(body, { status, headers }));
    });
    request.on("error", reject);
    request.end();
  });
};
export async function readPublicMaterial(url: string) {
  const deadline = AbortSignal.timeout(18000);
  try { return await fetchPublicPage(url, { fetch: (input, init) => pinnedFetch(input, { ...init, signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]) }), resolveHost: async host => (await resolvePublic(host)).map(record => record.address) }); }
  catch { return { error: "Faqja nuk u lexua. Kontrollo linkun ose ngarko përmbajtjen si skedar." }; }
}
