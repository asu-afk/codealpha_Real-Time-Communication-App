export interface UserProfile {
  uid: string;
  display_name: string;
  avatar_url: string;
}

export interface Room {
  id: string;
  host_id: string;
  name: string;
  join_code: string; // 6-char alphanumeric room join code
  is_active: boolean;
  started_at: number;
  ended_at?: number | null;
}

export interface RoomParticipant {
  room_id: string;
  user_id: string;
  socket_id?: string;
  joined_at: number;
  left_at?: number | null;
  role: 'host' | 'participant';
  name: string;
  avatar: string;
  cameraOn: boolean;
  micOn: boolean;
  screenShareOn: boolean;
}

export interface Message {
  id: string;
  room_id: string;
  user_id: string;
  user_name: string;
  user_avatar: string;
  body: string;
  kind: 'text' | 'file' | 'system';
  file_path?: string;
  file_url?: string;
  file_name?: string;
  created_at: number;
}

export interface WhiteboardSnapshot {
  id: string;
  room_id: string;
  data: string; // JSON string of whiteboard states / strokes
  created_at: number;
}

export interface Recording {
  id: string;
  room_id: string;
  storage_path: string;
  url: string;
  duration_s: number;
  created_at: number;
}

export interface WhiteboardStroke {
  points: number[];
  color: string;
  width: number;
  isEraser: boolean;
}
