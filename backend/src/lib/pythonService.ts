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

export async function callPythonService(path: string, params: Record<string, string>): Promise<ProxyResult> {
  const url = new URL(path, env.pythonServiceUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  let response: Response;
  try {
    response = await fetch(url, { headers: { "x-internal-key": env.pythonServiceInternalKey } });
  } catch {
    throw new ApiError(503, "Reports service is unavailable");
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
