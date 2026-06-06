export enum MessageType {
  CHAT = 'chat',
  SYSTEM = 'system',
  STREAM_START = 'stream_start',
  STREAM_CHUNK = 'stream_chunk',
  STREAM_END = 'stream_end',
  STREAM_ABORT = 'stream_abort',
  MENTION = 'mention',
  SIGNAL = 'signal',
}

export enum MessageVisibility {
  PUBLIC = 'public',
  ROLE_BASED = 'role_based',
  USER_BASED = 'user_based',
  PRIVATE = 'private',
}

export interface MessageMetadata {
  mentions?: string[];
  streamId?: string;
  chunkIndex?: number;
  done?: boolean;
  aborted?: boolean;
  isStreaming?: boolean;
  event?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  input: unknown;
  output?: unknown;
}

export interface Message {
  id: string;
  channelId: string;
  senderId: string;
  type: MessageType;
  content: string;
  metadata?: MessageMetadata;
  replyTo?: string;
  visibility: MessageVisibility;
  createdAt: string;
}

export type WireMessageType =
  | MessageType
  | 'action'
  | 'response'
  | 'error'
  | 'ping'
  | 'pong';

export interface WireMessage {
  id: string;
  type: WireMessageType;
  from: string;
  channel?: string;
  payload: unknown;
  ts: string;
}

export interface StreamEvent {
  streamId: string;
  chunkIndex: number;
  content: string;
  done: boolean;
  aborted: boolean;
}

export type SignalType = 'join' | 'leave' | 'typing' | 'interrupt' | 'wake';

export interface MentionPayload {
  mentionedEntityId: string;
  mentionedEntityName: string;
  channelId: string;
  messageId: string;
  fromEntityId: string;
  fromEntityName: string;
  context: string;
}
