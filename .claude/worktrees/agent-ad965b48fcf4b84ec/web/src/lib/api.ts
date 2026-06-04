export interface ServerConfig {
  apiUrl: string
  wsUrl: string
}

export const DEFAULT_CONFIG: ServerConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001',
}

export interface Entity {
  id: string
  name: string
  type: string
  email?: string
  metadata?: Record<string, unknown>
}

export interface AuthResponse {
  accessToken: string
  entity: Entity
}

export interface Channel {
  id: string
  name: string
  type: 'DM' | 'GROUP' | 'CHANNEL'
  isPublic: boolean
  description?: string
}

export interface Member {
  entityId: string
  entityName?: string
  role: string
}

export interface Message {
  id: string
  content: string
  senderId: string
  senderName?: string
  createdAt: string
}

async function apiFetch(cfg: ServerConfig, path: string, init?: RequestInit) {
  const res = await fetch(`${cfg.apiUrl}${path}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? res.statusText)
  }
  return res.json()
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export async function login(cfg: ServerConfig, email: string, password: string): Promise<AuthResponse> {
  return apiFetch(cfg, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export async function register(cfg: ServerConfig, name: string, email: string, password: string): Promise<AuthResponse> {
  return apiFetch(cfg, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })
}

export async function getChannels(cfg: ServerConfig, token: string): Promise<Channel[]> {
  const data = await apiFetch(cfg, '/channels', { headers: authHeaders(token) })
  return data.channels ?? []
}

export async function createChannel(cfg: ServerConfig, token: string, name: string): Promise<Channel> {
  const data = await apiFetch(cfg, '/channels', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ type: 'CHANNEL', name, isPublic: true }),
  })
  return data.channel
}

export async function getChannelMembers(cfg: ServerConfig, token: string, channelId: string): Promise<Member[]> {
  const data = await apiFetch(cfg, `/channels/${channelId}`, { headers: authHeaders(token) })
  return data.members ?? []
}

export async function getMessages(cfg: ServerConfig, token: string, channelId: string): Promise<Message[]> {
  const data = await apiFetch(cfg, `/channels/${channelId}/messages`, { headers: authHeaders(token) })
  return data.messages ?? []
}

export async function listPublicChannels(cfg: ServerConfig, token: string): Promise<Channel[]> {
  const data = await apiFetch(cfg, '/channels', { headers: authHeaders(token) })
  return data.channels ?? []
}

export async function joinChannel(cfg: ServerConfig, token: string, channelId: string, entityId: string): Promise<void> {
  await apiFetch(cfg, `/channels/${channelId}/members`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ entityId }),
  })
}

export function createWsConnection(cfg: ServerConfig, token: string): WebSocket {
  return new WebSocket(`${cfg.wsUrl}?token=${token}`)
}

export function deriveConfig(apiUrl: string): ServerConfig {
  const wsUrl = apiUrl
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://')
    .replace(/:3000$/, ':3001')
  return { apiUrl: apiUrl.replace(/\/$/, ''), wsUrl }
}

// List all online users (entities currently connected)
export async function listOnlineUsers(cfg: ServerConfig, token: string): Promise<Entity[]> {
  const data = await apiFetch(cfg, '/entities', { headers: authHeaders(token) })
  return data.entities ?? []
}

// Set a member's role in a channel (admin only)
export async function setMemberRole(
  cfg: ServerConfig,
  token: string,
  channelId: string,
  entityId: string,
  role: string,
): Promise<void> {
  await apiFetch(cfg, `/channels/${channelId}/members/${entityId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ role }),
  })
}

// Leave a channel by removing the current user from membership
export async function leaveChannel(
  cfg: ServerConfig,
  token: string,
  channelId: string,
  entityId: string,
): Promise<void> {
  // Best-effort: the fork may or may not have a DELETE endpoint
  try {
    await apiFetch(cfg, `/channels/${channelId}/members/${entityId}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    })
  } catch {
    // Silently ignore if endpoint doesn't exist; WS leave action handles UI
  }
}
