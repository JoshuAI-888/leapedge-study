import {
  constantEqual,
  sessionToken,
} from "../../../server/youtube-intelligence/access";
export async function POST(r: Request) {
  const configured = process.env.YTI_APP_ORIGIN,
    key = process.env.YTI_ACCESS_TOKEN;
  if (!configured || !key || key.length < 32)
    return new Response("Hosted access is not configured.", { status: 503 });
  const origin = new URL(configured).origin;
  if (r.headers.get("origin") !== origin)
    return new Response("Origin denied.", { status: 403 });
  const body = await r.text();
  if (body.length > 1024)
    return new Response("Invalid access code.", { status: 401 });
  const code = new URLSearchParams(body).get("code") || "";
  if (!constantEqual(code, key))
    return new Response("Invalid access code.", { status: 401 });
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${origin}/research`,
      "Set-Cookie": `yti_session=${sessionToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${origin.startsWith("https:") ? "; Secure" : ""}`,
      "Cache-Control": "no-store",
    },
  });
}
