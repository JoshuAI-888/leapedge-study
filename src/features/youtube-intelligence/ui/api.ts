import { z } from "zod";

export async function request<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    signal,
  });
  const value = await response.json();
  if (!response.ok) {
    let message = String(value.error || `Request failed (${response.status}).`);
    try {
      const issues = JSON.parse(message);
      if (Array.isArray(issues))
        message = issues
          .map(
            (issue) =>
              `${Array.isArray(issue.path) ? issue.path.join(" → ") : "Input"}: ${issue.message}`,
          )
          .join("; ");
    } catch {
      /* Ordinary server messages already read as prose. */
    }
    throw Error(message);
  }
  return value as T;
}
export const action = <T = unknown>(
  resource: string,
  name: string,
  body?: unknown,
) => request<T>(`/api/youtube-intelligence/${resource}/${name}`, body);

/** Mutations return an envelope; validate before using an id in navigation. */
export async function analyseRun(input: { url: string; force?: boolean }) {
  const value = await action("runs", "analyse", input);
  return z.object({
    result: z.object({
      runId: z.string().uuid(),
      reused: z.boolean().optional(),
    }),
  }).parse(value).result;
}
/**
 * A read action that takes input (the query resource, F56): GET with the input
 * as JSON in `?input=`, so it stays available in a read-only preview.
 */
export const read = <T = unknown>(
  resource: string,
  name: string,
  input: unknown,
  signal?: AbortSignal,
) =>
  request<T>(
    `/api/youtube-intelligence/${resource}/${name}?input=${encodeURIComponent(JSON.stringify(input))}`,
    undefined,
    signal,
  );
/** Same as `read`; the name the Saved page (F75) uses. */
export const readAction = read;
