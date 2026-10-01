/** Install only this standalone workspace's launchd services; credentials stay in .env.live. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (process.platform !== "darwin")
  throw Error("This installer is for macOS only.");
const postgres = "/opt/homebrew/opt/postgresql@16/bin/postgres";
if (
  !existsSync(postgres) ||
  !existsSync(resolve(root, "data/postgres/PG_VERSION")) ||
  !existsSync(resolve(root, ".env.live"))
)
  throw Error(
    "Prepare the isolated local PostgreSQL cluster and ignored .env.live first.",
  );
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const services = [
  {
    name: "postgres",
    args: [
      postgres,
      "-D",
      resolve(root, "data/postgres"),
      "-h",
      "127.0.0.1",
      "-p",
      "57484",
      "-k",
      "/private/tmp",
    ],
  },
  {
    name: "worker",
    args: [
      process.execPath,
      "--env-file=.env.live",
      "--experimental-strip-types",
      "scripts/worker.ts",
    ],
  },
  {
    name: "web",
    args: [
      process.execPath,
      "--env-file=.env.live",
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3019",
    ],
  },
];
const install = process.argv.includes("--install");
const directory = install
  ? resolve(homedir(), "Library/LaunchAgents")
  : resolve(root, "data/worker/services");
mkdirSync(directory, { recursive: true });
mkdirSync(resolve(root, "data/worker"), { recursive: true });
for (const service of services) {
  const label = `com.joshuai.yti.${service.name}`;
  const path = resolve(directory, `${label}.plist`);
  if (install && existsSync(path))
    throw Error(
      `Service already installed: ${label}. Inspect before replacing it.`,
    );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${service.args.map((x) => `<string>${escape(x)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>LC_ALL</key><string>C</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ExitTimeOut</key><integer>900</integer><key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>${escape(resolve(root, `data/worker/${service.name}.log`))}</string>
<key>StandardErrorPath</key><string>${escape(resolve(root, `data/worker/${service.name}-error.log`))}</string>
</dict></plist>\n`;
  writeFileSync(path, xml, { mode: 0o600 });
  execFileSync("/usr/bin/plutil", ["-lint", path], { stdio: "pipe" });
  if (install)
    execFileSync(
      "/bin/launchctl",
      ["bootstrap", `gui/${process.getuid!()}`, path],
      { stdio: "pipe" },
    );
  console.log(`${install ? "Installed" : "Prepared"} ${label}: ${path}`);
}
