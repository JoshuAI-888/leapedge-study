import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
for (const name of [
  "TAPLINE_API_KEY",
  "SUPADATA_API_KEY",
  "TRANSCRIPTAPI_API_KEY",
])
  if (!process.env[name]) throw Error(name + " is required");
mkdirSync("data/provider-benchmark/raw", { recursive: true });
const file = "data/provider-benchmark/results.json";
const rows = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
const cases = [
  ["wkAqHlYL7bQ", "en"],
  ["v824SHV6COE", "en"],
  ["SHMPiWbbR6E", "en"],
  ["3u24qyWjSVM", "zh-CN"],
  ["J25UuUqHT3Y", "zh-CN"],
  ["CMjt6f4eVdA", "zh-CN"],
];
for (let round = 1; round <= 3; round++)
  for (const [videoId, language] of cases) {
    await Promise.all(
      ["tapline", "supadata", "transcriptapi"].map(async (provider) => {
        if (
          rows.some(
            (x) =>
              x.videoId === videoId &&
              x.provider === provider &&
              (x.round === round ||
                ["transport_uncertain", "submitted"].includes(x.status)),
          )
        )
          return;
        let url, headers;
        if (provider === "tapline") {
          url = new URL(
            `https://api.tapline.sh/api/v1/youtube/videos/${videoId}/subtitles`,
          );
          url.search = new URLSearchParams({
            language,
            subtitle_format: "srt",
          });
          headers = { "X-API-Key": process.env.TAPLINE_API_KEY };
        } else if (provider === "supadata") {
          url = new URL("https://api.supadata.ai/v1/transcript");
          url.search = new URLSearchParams({
            url: `https://www.youtube.com/watch?v=${videoId}`,
            mode: "native",
            text: "false",
            lang: language,
          });
          headers = { "x-api-key": process.env.SUPADATA_API_KEY };
        } else {
          url = new URL("https://transcriptapi.com/api/v2/youtube/transcript");
          url.search = new URLSearchParams({
            video_url: videoId,
            format: "json",
            include_timestamp: "true",
            language,
          });
          headers = {
            Authorization: `Bearer ${process.env.TRANSCRIPTAPI_API_KEY}`,
          };
        }
        const started = Date.now();
        const pendingIndex = rows.length;
        rows.push({
          provider,
          videoId,
          language,
          round,
          status: "submitted",
          at: new Date(started).toISOString(),
        });
        writeFileSync(file, JSON.stringify(rows, null, 2));
        let row;
        try {
          const r = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(60000),
          });
          const text = await r.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {}
          writeFileSync(
            `data/provider-benchmark/raw/${provider}-${videoId}-${round}.json`,
            text,
          );
          const source =
            provider === "supadata"
              ? data?.content
              : provider === "transcriptapi"
                ? data?.transcript
                : data?.transcript;
          const present =
            typeof source === "string"
              ? !!source.trim()
              : Array.isArray(source)
                ? source.length > 0
                : false;
          row = {
            provider,
            videoId,
            language,
            round,
            at: new Date(started).toISOString(),
            http: r.status,
            durationMs: Date.now() - started,
            status:
              r.ok && present
                ? "retrieved"
                : r.ok
                  ? "empty_or_invalid"
                  : "http_error",
            code: data?.code || data?.error,
            hash: present
              ? createHash("sha256")
                  .update(JSON.stringify(source))
                  .digest("hex")
              : null,
            bytes: present ? Buffer.byteLength(JSON.stringify(source)) : 0,
            cache: r.headers.get("x-cache") || r.headers.get("cf-cache-status"),
            documentedMaxCredits:
              provider === "tapline"
                ? r.ok
                  ? 2
                  : 0
                : provider === "supadata"
                  ? 1
                  : r.ok
                    ? 1
                    : 0,
          };
        } catch {
          row = {
            provider,
            videoId,
            language,
            round,
            at: new Date(started).toISOString(),
            durationMs: Date.now() - started,
            status: "transport_uncertain",
            documentedMaxCredits: provider === "tapline" ? 2 : 1,
          };
        }
        rows[pendingIndex] = row;
        writeFileSync(file, JSON.stringify(rows, null, 2));
        console.log(JSON.stringify(row));
      }),
    );
    await new Promise((r) => setTimeout(r, 1100));
  }
