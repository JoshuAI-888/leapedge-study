import { timingSafeEqual, createHmac } from "node:crypto";
export function constantEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function sessionToken(at = Date.now()) {
  const key = process.env.YTI_ACCESS_TOKEN;
  if (!key || key.length < 32)
    throw Error(
      "A strong workspace access secret is required for hosted mode.",
    );
  const expiry = String(at + 12 * 3600000);
  return `${expiry}.${createHmac("sha256", key).update(expiry).digest("hex")}`;
}
export function validSession(token: string) {
  const key = process.env.YTI_ACCESS_TOKEN;
  if (!key || key.length < 32) return false;
  const [expiry, signature, ...extra] = token.split(".");
  if (
    extra.length ||
    !/^\d+$/.test(expiry) ||
    Number(expiry) < Date.now() ||
    Number(expiry) > Date.now() + 12 * 3600000 ||
    !signature
  )
    return false;
  return constantEqual(
    signature,
    createHmac("sha256", key).update(expiry).digest("hex"),
  );
}
export function requestSession(r: Request) {
  const cookie = (r.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("yti_session="));
  return validSession(cookie?.slice("yti_session=".length) || "");
}
