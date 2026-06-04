import { z } from 'zod';
import type { WsBridge } from '../ws-bridge.js';

export async function joinChannel(channelId: string, bridge: WsBridge) {
  await bridge.joinChannel(channelId);
  return { success: true, channelId };
}

export async function leaveChannel(channelId: string, bridge: WsBridge) {
  await bridge.leaveChannel(channelId);
  return { success: true, channelId };
}

export async function listChannels(bridge: WsBridge) {
  const channels = await bridge.listChannels();
  return { channels };
}

export async function listMembers(channelId: string, bridge: WsBridge) {
  const members = await bridge.listMembers(channelId);
  return { channelId, members };
}

export async function getContext(channelId: string, limit: number, jwt: string) {
  const apiUrl = process.env.API_SERVER_URL ?? 'http://localhost:3000';
  const res = await fetch(`${apiUrl}/channels/${channelId}/context?limit=${limit}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const err = await res.json() as { error?: string };
      if (err.error) errorMsg = err.error;
    } catch {}
    throw new Error(errorMsg);
  }

  return res.json();
}

export const JoinChannelSchema = z.object({
  channelId: z.string().describe('Channel ID to join (will be auto-created if it does not exist)'),
});

export const LeaveChannelSchema = z.object({
  channelId: z.string().describe('Channel ID to leave'),
});

export const ListMembersSchema = z.object({
  channelId: z.string().describe('Channel ID to list members of'),
});

export const GetContextSchema = z.object({
  channelId: z.string().describe('Channel ID to get context from'),
  limit: z.number().int().min(1).max(200).default(20).describe('Number of recent messages to include'),
});
