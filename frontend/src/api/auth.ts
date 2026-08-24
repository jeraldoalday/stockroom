import { apiClient } from "./client";
import type { AuthResponse } from "./types";

export interface SignupPayload {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export async function signup(payload: SignupPayload): Promise<AuthResponse> {
  const res = await apiClient.post<AuthResponse>("/auth/signup", payload);
  return res.data;
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const res = await apiClient.post<AuthResponse>("/auth/login", payload);
  return res.data;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export async function changePassword(payload: ChangePasswordPayload): Promise<void> {
  await apiClient.patch("/auth/password", payload);
}

export async function forgotPassword(email: string): Promise<void> {
  await apiClient.post("/auth/forgot-password", { email });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await apiClient.post("/auth/reset-password", { token, newPassword });
}

/** One live sign-in: a browser or device with a working refresh token. */
export interface Session {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  /** True for the session this browser is making the request from. */
  current: boolean;
  /** Null for a session that predates this field, or sent no header at all. */
  userAgent: string | null;
}

export async function fetchSessions(): Promise<Session[]> {
  const res = await apiClient.get<Session[]>("/auth/sessions");
  return res.data;
}

export async function endSession(id: string): Promise<void> {
  await apiClient.delete(`/auth/sessions/${id}`);
}
