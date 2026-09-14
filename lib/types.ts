export interface ApiPost {
  id: string;
  board_id: string;
  emotion_id: string | null;
  text: string;
  nickname: string | null;
  status: "published" | "pending" | "hidden";
  created_at: number;
  reaction_heart: number;
  reaction_idea: number;
  reaction_surprise: number;
  moderated_by: string | null;
}

export interface ApiAdmin {
  id: string;
  username: string;
  created_at: number;
  created_by: string | null;
}

export interface ApiUser {
  id: string;
  username: string;
  display_name: string | null;
  role: "officer" | "member" | "general";
  created_at: number;
  role_updated_by: string | null;
  role_updated_at: number | null;
}

export interface ApiBoard {
  id: string;
  kind: "main" | "extra";
  emoji: string;
  title: string;
  question: string;
  accent: string;
  count: number;
  requiresApproval: boolean;
}
