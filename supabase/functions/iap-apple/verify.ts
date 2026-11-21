// Проверка покупки Apple (StoreKit 2): подписанная транзакция в формате JWS.
// Цепочка сертификатов из заголовка (x5c) должна вести к корню Apple Root CA - G3 (сверяем отпечаток SHA-256),
// каждый сертификат подписан следующим, у листового и промежуточного — отметки Apple, а сама подпись JWS
// проверяется ключом листового сертификата. Сеть для проверки не нужна.
import * as x509 from "npm:@peculiar/x509@1.12.3";

x509.cryptoProvider.set(crypto);

// Apple Root CA - G3, отпечаток SHA-256 (support.apple.com, список корневых сертификатов iOS 26)
export const APPLE_ROOT_G3_SHA256 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";
const OID_LEAF = "1.2.840.113635.100.6.11.1";   // сертификат подписи App Store
const OID_INTER = "1.2.840.113635.100.6.2.1";   // промежуточный Apple WWDR

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (s: string) => b64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
const text = (u: Uint8Array) => new TextDecoder().decode(u);
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function verifyAppleJws(jws: string, rootSha256 = APPLE_ROOT_G3_SHA256, at = new Date()) {
  const parts = String(jws || "").split(".");
  if (parts.length !== 3) throw new Error("bad jws");
  const [h, p, s] = parts;
  const header = JSON.parse(text(b64url(h)));
  if (header.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length !== 3) throw new Error("bad header");
  const [leaf, inter, root] = header.x5c.map((c: string) => new x509.X509Certificate(b64(c)));
  if (hex(await crypto.subtle.digest("SHA-256", root.rawData)) !== rootSha256.toLowerCase()) throw new Error("untrusted root");
  for (const c of [leaf, inter, root]) if (c.notBefore > at || c.notAfter < at) throw new Error("certificate expired");
  if (!(await root.verify({ publicKey: root.publicKey, signatureOnly: true }))) throw new Error("bad root");
  if (!(await inter.verify({ publicKey: root.publicKey, signatureOnly: true }))) throw new Error("bad intermediate");
  if (!(await leaf.verify({ publicKey: inter.publicKey, signatureOnly: true }))) throw new Error("bad leaf");
  if (!inter.getExtension(OID_INTER) || !leaf.getExtension(OID_LEAF)) throw new Error("not an Apple certificate");
  const key = await crypto.subtle.importKey("spki", leaf.publicKey.rawData, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64url(s), new TextEncoder().encode(h + "." + p));
  if (!ok) throw new Error("bad signature");
  return JSON.parse(text(b64url(p)));
}
