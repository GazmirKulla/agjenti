import { expect, it } from "vitest";
import { isPublicAddress, readPublicMaterial } from "./public-page";
it("rejects private, mapped, transition and reserved addresses", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "2002:7f00:1::", "2001:db8::1", "invalid"]) expect(isPublicAddress(address), address).toBe(false);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(address), address).toBe(true);
});
it("blocks literal local URLs and non-http protocols without opening sockets", async () => {
  for (const url of ["http://127.0.0.1", "http://[::ffff:7f00:1]", "http://localhost", "file:///etc/passwd", "https://user:pass@example.com"]) expect(await readPublicMaterial(url)).toHaveProperty("error");
});
