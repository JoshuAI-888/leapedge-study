import { request } from "./api.ts";
/**
 * A read action with input: GET with the input as JSON in `?input=` (F56's
 * convention), so reads stay GETs and remain allowed in a read-only preview.
 */
export function getAction<T>(
  resource: string,
  name: string,
  input?: unknown,
  signal?: AbortSignal,
) {
  const query =
    input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  return request<T>(
    `/api/youtube-intelligence/${resource}/${name}${query}`,
    undefined,
    signal,
  );
}
