import { AxiosError } from "axios";
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { apiClient } from "../api/client";

export interface MockResponseSpec {
  status: number;
  data?: unknown;
}

/** A 2xx with a body. */
export function ok(data?: unknown, status = 200): MockResponseSpec {
  return { status, data };
}

/** A failure shaped like the API's error envelope, `{ error, details? }`. */
export function fail(status: number, error = "Something went wrong", details?: unknown): MockResponseSpec {
  return { status, data: details === undefined ? { error } : { error, details } };
}

type RouteKey = string;

function keyFor(method: string, url: string): RouteKey {
  return `${method.toUpperCase()} ${url}`;
}

/**
 * Swaps `apiClient`'s transport for an in-memory one.
 *
 * Deliberately an *adapter* rather than `vi.mock("axios")`: the adapter is
 * the last link in the chain, so a request still runs through the real
 * request interceptor (which attaches the bearer token) and a real failure
 * still runs through the real response interceptor (which refreshes and
 * retries). Mocking the module out would replace exactly the code these
 * tests exist to cover.
 */
export class MockApi {
  /** Every request that reached the transport, in order, post-interceptor. */
  readonly requests: InternalAxiosRequestConfig[] = [];

  private readonly routes = new Map<RouteKey, MockResponseSpec[]>();
  private readonly originalAdapter: AxiosAdapter | AxiosAdapter[] | string | string[] | undefined;

  constructor() {
    this.originalAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = this.adapter;
  }

  /**
   * Queues one response per call for `METHOD url`. The final entry repeats,
   * so `on("GET", "/products", ok(a))` answers every poll, while
   * `on("GET", "/x", fail(401), ok(data))` models "fails, then succeeds
   * after the token is refreshed".
   */
  on(method: string, url: string, ...responses: MockResponseSpec[]): this {
    if (responses.length === 0) throw new Error("MockApi.on needs at least one response");
    this.routes.set(keyFor(method, url), [...responses]);
    return this;
  }

  /** Requests recorded for one route, for asserting on headers or bodies. */
  requestsFor(method: string, url: string): InternalAxiosRequestConfig[] {
    return this.requests.filter((r) => keyFor(r.method ?? "get", r.url ?? "") === keyFor(method, url));
  }

  restore(): void {
    apiClient.defaults.adapter = this.originalAdapter;
  }

  private adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    this.requests.push(config);

    const key = keyFor(config.method ?? "get", config.url ?? "");
    const queue = this.routes.get(key);
    if (!queue) {
      // Loud on purpose. A silent 404-shaped default would let a test pass
      // while the component called a completely different endpoint.
      throw new Error(
        `MockApi: no response queued for ${key}. Queued routes: ${[...this.routes.keys()].join(", ") || "(none)"}`
      );
    }

    const spec = queue.length > 1 ? (queue.shift() as MockResponseSpec) : queue[0];
    const response: AxiosResponse = {
      data: spec.data,
      status: spec.status,
      statusText: "",
      headers: {},
      config,
    };

    if (spec.status >= 200 && spec.status < 300) return response;
    throw new AxiosError(
      `Request failed with status code ${spec.status}`,
      spec.status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST",
      config,
      {},
      response
    );
  };
}
