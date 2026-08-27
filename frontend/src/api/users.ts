import { apiClient } from "./client";
import type { TeamMember, TeamMemberListResponse, UserRole } from "./types";

export async function fetchTeamMembers(): Promise<TeamMemberListResponse> {
  const res = await apiClient.get<TeamMemberListResponse>("/users");
  return res.data;
}

export interface InviteUserPayload {
  name: string;
  email: string;
  role: UserRole;
}

export async function inviteTeamMember(payload: InviteUserPayload): Promise<TeamMember> {
  const res = await apiClient.post<TeamMember>("/users", payload);
  return res.data;
}

export async function updateTeamMemberRole(id: string, role: UserRole): Promise<TeamMember> {
  const res = await apiClient.patch<TeamMember>(`/users/${id}`, { role });
  return res.data;
}

export async function removeTeamMember(id: string): Promise<void> {
  await apiClient.delete(`/users/${id}`);
}

export async function unlockTeamMemberLogin(id: string): Promise<{ wasLockedOut: boolean }> {
  const res = await apiClient.post<{ wasLockedOut: boolean }>(`/users/${id}/unlock-login`);
  return res.data;
}
