import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { WsBridge } from '../ws-bridge.js';

export async function sendMessage(
  params: { channelId: string; content: string; mentions?: string[]; replyTo?: string },
  bridge: WsBridge
) {
  bridge.sendChat(params.channelId, params.content, params.mentions, params.replyTo);
  return { success: true, channelId: params.channelId };
}

export async function streamOutput(
  params: { channelId: string; streamId?: string; content: string; done: boolean },
  bridge: WsBridge,
  activeStreams: Map<string, AbortController>
) {
  const streamId = params.streamId ?? randomUUID().slice(0, 8);

  if (!activeStreams.has(streamId) && !params.done) {
    await bridge.startStream(params.channelId, streamId);
    activeStreams.set(streamId, new AbortController());
  }

  if (!params.done) {
    bridge.sendChunk(params.channelId, streamId, params.content);
  } else {
    bridge.endStream(params.channelId, streamId, params.content || undefined);
    activeStreams.delete(streamId);
  }

  return { success: true, streamId, done: params.done };
}

export async function abortStream(
  params: { channelId: string; streamId: string },
  bridge: WsBridge,
  activeStreams: Map<string, AbortController>
) {
  const controller = activeStreams.get(params.streamId);
  if (controller) {
    controller.abort();
    activeStreams.delete(params.streamId);
  }
  bridge.abortStream(params.channelId, params.streamId);
  return { success: true, streamId: params.streamId };
}

export async function readHistory(channelId: string, limit: number, cursor: string | undefined, jwt: string) {
  const apiUrl = process.env.API_SERVER_URL ?? 'http://localhost:3000';
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);

  const res = await fetch(`${apiUrl}/channels/${channelId}/messages?${query}`, {
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

export const SendMessageSchema = z.object({
  channelId: z.string().describe('Target channel ID'),
  content: z.string().describe('Message content (supports @mentions with @name syntax)'),
  mentions: z.array(z.string()).optional().describe('Explicit list of entity IDs to mention'),
  replyTo: z.string().optional().describe('Message ID to reply to'),
});

export const StreamOutputSchema = z.object({
  channelId: z.string().describe('Target channel ID'),
  streamId: z.string().optional().describe('Stream session ID (auto-generated if omitted for first chunk)'),
  content: z.string().describe('Chunk content to stream, or full content when done=true'),
  done: z.boolean().describe('Set to true to finalize and close the stream'),
});

export const AbortStreamSchema = z.object({
  channelId: z.string().describe('Channel ID where the stream is active'),
  streamId: z.string().describe('Stream session ID to abort'),
});

export const ReadHistorySchema = z.object({
  channelId: z.string().describe('Channel ID to read history from'),
  limit: z.number().int().min(1).max(100).default(20).describe('Number of messages to retrieve'),
  cursor: z.string().optional().describe('Message ID cursor for pagination (exclusive, returns messages before this ID)'),
});

export const GetUnreadSchema = z.object({
  channelId: z.string().describe('Channel ID to check for unread messages'),
  since: z.string().optional().describe('ISO-8601 timestamp to get messages after'),
});

export const WaitForMentionSchema = z.object({
  timeout: z.number().int().min(5).max(120).default(55)
    .describe('Seconds to wait before timing out (5-120). Default 55s.'),
  channelId: z.string().optional()
    .describe('Only wake on mentions in this channel. Omit to listen across all joined channels.'),
});
