import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  getStoredToken,
  revokeSessionOnServer,
  setSessionExpiredHandler,
  setStoredRefreshToken,
  setStoredToken,
} from "../api/client";
import type { AuthResponse, AuthUser } from "../api/types";

const USER_STORAGE_KEY = "stockroom_user";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  setSession: (auth: AuthResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function loadStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser);

  const setSession = (auth: AuthResponse) => {
    setStoredToken(auth.accessToken);
    // The refresh token used to be dropped on the floor here, which is why
    // sessions died after 15 minutes — see api/client.ts.
    setStoredRefreshToken(auth.refreshToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(auth.user));
    setUser(auth.user);
  };

  const logout = () => {
    // Fired before the tokens are cleared, since it needs the refresh token
    // to name the session. Not awaited: the UI signs out immediately and the
    // revocation lands on its own.
    void revokeSessionOnServer();
    setStoredToken(null);
    setStoredRefreshToken(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
  };

  // When a refresh fails there is no recoverable session left, so the API
  // layer signals up here to clear the user. Dropping `user` flips
  // `isAuthenticated`, and ProtectedRoute redirects to /login on its own —
  // no imperative navigation from inside an interceptor.
  useEffect(() => {
    // Only the user half: `endStoredSession` has already cleared the
    // tokens by the time it calls this.
    setSessionExpiredHandler(() => {
      localStorage.removeItem(USER_STORAGE_KEY);
      setUser(null);
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: Boolean(user && getStoredToken()), setSession, logout }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
