import { env } from "./env";
import { ApiError } from "./errors";

// The frontend never talks to the Python service directly (see PRD §8);
// these routes are the only caller, so every request carries the shared
// internal key the Python side checks in require_internal_caller().
interface ProxyResult {
  contentType: string;
  contentDisposition: string | null;
  body: string;
}

export async function callPythonService(
  path: string,
  params: Record<string, string>,
  requestId?: string
): Promise<ProxyResult> {
  const url = new URL(path, env.pythonServiceUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  // Forwarding the Node API's own request id lets the two services' logs be
  // correlated by grepping one id, instead of lining requests up by
  // timestamp when a report call is slow or fails on the Python side.
  const headers: Record<string, string> = { "x-internal-key": env.pythonServiceInternalKey };
  if (requestId) headers["x-request-id"] = requestId;

  // AbortController covers the case `fetch`'s own rejection doesn't: a
  // service that accepted the connection but never finishes responding
  // (stuck on a slow query, deadlocked, etc.) otherwise hangs this request
  // — and the client's — for as long as the client is willing to wait.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.pythonServiceTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: controller.signal });
  } catch {
    throw new ApiError(503, "Reports service is unavailable");
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new ApiError(502, "Reports service request failed");
  }

  return {
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    contentDisposition: response.headers.get("content-disposition"),
    body,
  };
}
