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
/** A read that takes input: GET with the input as JSON in `?input=` (F75). */
export const readAction = <T = unknown>(
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
