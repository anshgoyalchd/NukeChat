export type RoomType = 'timed' | 'p2p';
export type RoomVisibility = 'private' | 'open';
export type RoomState = 'CREATING' | 'ACTIVE' | 'EXPIRING' | 'NUKING' | 'DESTROYED';

export interface Participant {
  id: string;
  identity: string;
  avatar: string;
  joinedAt: number;
  isActive: boolean;
}

export interface EncryptedMessage {
  messageId: string;
  senderId: string;
  timestamp: number;
  nonce: string;
  ciphertext: string;
}

export interface NukeVotesState {
  votesCount: number;
  neededVotes: number;
  votedParticipantIds: string[];
}

export interface WsEnvelope<T = any> {
  type: string;
  senderId: string;
  timestamp: number;
  payload: T;
}

export const WsEventType = {
  ROOM_JOINED: 'ROOM_JOINED',
  ROOM_LEFT: 'ROOM_LEFT',
  MESSAGE_SENT: 'MESSAGE_SENT',
  MESSAGE_BROADCAST: 'MESSAGE_BROADCAST',
  PEER_JOINED: 'PEER_JOINED',
  PEER_LEFT: 'PEER_LEFT',
  SIGNAL: 'SIGNAL',
  NUKE_VOTE_CAST: 'NUKE_VOTE_CAST',
  ROOM_NUKED: 'ROOM_NUKED',
  ROOM_EXPIRED: 'ROOM_EXPIRED',
  HEARTBEAT: 'HEARTBEAT'
} as const;

export type WsEventType = typeof WsEventType[keyof typeof WsEventType];

export interface RoomCreatedPayload {
  roomCode: string;
  internalRoomId: string;
  salt: string;
  expiresAt: string;
}

export interface RoomJoinResponse {
  success: boolean;
  internalRoomId: string;
  type: RoomType;
  expiresAt: string;
  salt: string;
  participantCount: number;
}

export interface SignalPayload {
  targetId: string;
  signal: {
    type: 'sdp-offer' | 'sdp-answer' | 'ice-candidate';
    data: any;
  };
}

export interface FileOfferPayload {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  totalChunks: number;
  hash: string;
}
