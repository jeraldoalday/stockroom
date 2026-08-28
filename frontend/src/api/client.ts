import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

const TOKEN_STORAGE_KEY = "stockroom_access_token";
const REFRESH_TOKEN_STORAGE_KEY = "stockroom_refresh_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
}

export function setStoredRefreshToken(token: string | null) {
  if (token) {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  }
}

apiClient.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// The API issues a 15-minute access token alongside a 7-day refresh token
// (JWT_ACCESS_TTL / JWT_REFRESH_TTL). The refresh token was being thrown
// away at sign-in and /api/auth/refresh was never called, so the app simply
// broke fifteen minutes into a session: every request 401'd, nothing
// retried, and the screens showed "Failed to load ..." until the user
// worked out that signing out and back in fixed it.

/** Called when the session can't be recovered — wired to AuthContext's
 * logout so the app clears its user and bounces to /login. */
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

/**
 * Tears down a session that can no longer be recovered.
 *
 * Clearing the tokens and telling the app about it belong together — a
 * caller that did one without the other would leave either a signed-in UI
 * with no credentials or credentials with no UI. Both halves used to live
 * inline in the interceptor's catch block, with `AuthContext`'s handler
 * repeating the token half a second time.
 */
export function endStoredSession(): void {
  setStoredToken(null);
  setStoredRefreshToken(null);
  onSessionExpired?.();
}

// A page typically has several queries in flight at once, so an expired
// token produces a burst of simultaneous 401s. They share one refresh
// request: the first 401 starts it and the rest await the same promise,
// rather than each firing its own refresh and racing to overwrite the
// token (where the losers write a token that's already been superseded).
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    throw new Error("No refresh token stored");
  }

  // A bare axios call, not apiClient: going through the instance would
  // attach the dead access token and re-enter this same interceptor on
  // failure, which is an infinite loop waiting to happen.
  const res = await axios.post<{ accessToken: string; refreshToken: string }>(
    `${import.meta.env.VITE_API_URL}/auth/refresh`,
    { refreshToken }
  );

  setStoredToken(res.data.accessToken);
  // The server rotates on every refresh: the token just spent is revoked,
  // and presenting it again is treated as a replay and burns the whole
  // session family. So persisting the new one is not an optimisation — drop
  // it and the *next* refresh signs the user out for good.
  setStoredRefreshToken(res.data.refreshToken);
  return res.data.accessToken;
}

/**
 * Ends the session server-side as well as locally.
 *
 * Best-effort: a failure here still clears local storage, because a user who
 * clicked "sign out" must end up signed out of this browser whatever the
 * network did. The cost of the request failing is a refresh token that stays
 * valid until it expires, which is exactly where things stood before there
 * was a logout endpoint at all.
 */
export async function revokeSessionOnServer(): Promise<void> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return;
  try {
    await axios.post(`${import.meta.env.VITE_API_URL}/auth/logout`, { refreshToken });
  } catch {
    // Deliberately ignored — see above.
  }
}

type RetriableRequest = InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean };

// Refreshing on a failed sign-in attempt makes no sense — a 401 from these
// means "wrong password", not "expired token".
const AUTH_ENDPOINTS = ["/auth/login", "/auth/signup", "/auth/refresh"];

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as RetriableRequest | undefined;

    const isExpiredSession =
      error.response?.status === 401 &&
      request !== undefined &&
      !request._retriedAfterRefresh &&
      !AUTH_ENDPOINTS.some((path) => request.url?.startsWith(path));

    if (!isExpiredSession) {
      return Promise.reject(error);
    }

    try {
      refreshInFlight = refreshInFlight ?? refreshAccessToken();
      const accessToken = await refreshInFlight;

      request._retriedAfterRefresh = true;
      request.headers.Authorization = `Bearer ${accessToken}`;
      return await apiClient(request);
    } catch {
      // The refresh token is expired or the user was deleted; nothing to
      // recover, so end the session rather than leaving a half-dead one.
      endStoredSession();
      return Promise.reject(error);
    } finally {
      refreshInFlight = null;
    }
  }
);
