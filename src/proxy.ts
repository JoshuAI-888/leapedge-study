import { NextResponse, type NextRequest } from "next/server";
import {
  validSession,
  workspaceOrigin,
} from "./server/youtube-intelligence/access";
export function proxy(r: NextRequest) {
  const origin = workspaceOrigin();
  if (!origin) return NextResponse.next();
  const path = r.nextUrl.pathname;
  if (path.startsWith("/share/"))
    return process.env.YTI_PUBLIC_SHARES === "true"
      ? NextResponse.next()
      : new NextResponse("Public shares are disabled.", { status: 404 });
  if (path === "/api/cron/intelligence" || path === "/api/email/webhook")
    return NextResponse.next();
  if (path === "/access" || path === "/api/access") return NextResponse.next();
  if (!validSession(r.cookies.get("yti_session")?.value || "")) {
    if (path.startsWith("/api/"))
      return NextResponse.json(
        { error: "Workspace access required." },
        { status: 401 },
      );
    return NextResponse.redirect(new URL("/access", origin));
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
