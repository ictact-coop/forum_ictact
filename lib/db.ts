import { createClient, type Client } from "@libsql/client";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import { BoardId } from "./boards";

// DATABASE_URL을 지정하지 않으면 로컬 파일(SQLite)에 저장합니다.
// - 저비용 운영을 원하면 Turso(무료 티어의 libSQL 호스팅)의 libsql:// 주소와
//   DATABASE_AUTH_TOKEN을 넣어 완전 서버리스로 배포할 수 있습니다. (README 참고)
const DATABASE_URL = process.env.DATABASE_URL || defaultLocalUrl();
const DATABASE_AUTH_TOKEN = process.env.DATABASE_AUTH_TOKEN;

// Vercel 등 서버리스 환경은 배포된 코드의 파일시스템이 읽기 전용이라(/var/task, ...)
// 로컬 SQLite 파일을 새로 만들 수 없습니다. 이런 환경에서 DATABASE_URL이 비어 있으면
// "ENOENT: mkdir" 같은 알아보기 힘든 오류 대신, 바로 원인을 알 수 있는 오류를 던집니다.
function isReadOnlyServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
}

function defaultLocalUrl(): string {
  if (isReadOnlyServerless()) {
    throw new Error(
      "DATABASE_URL 환경변수가 설정되지 않았어요. Vercel 등 서버리스 환경은 파일시스템이 읽기 전용이라 " +
        "로컬 SQLite 파일을 쓸 수 없습니다. Turso 같은 곳에서 만든 DATABASE_URL(libsql://...)과 " +
        "DATABASE_AUTH_TOKEN을 프로젝트 환경변수에 등록한 뒤 반드시 '다시 배포(Redeploy)'까지 해주세요 " +
        "— 환경변수만 저장하면 이미 만들어진 배포에는 적용되지 않습니다. (README '운영 환경 추천' 참고)"
    );
  }
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return `file:${path.join(dataDir, "forum.db")}`;
}

// Next.js dev 모드는 모듈을 여러 번 로드할 수 있으므로 전역에 캐싱합니다.
const globalForDb = globalThis as unknown as { __forumDb?: Client };

export const db =
  globalForDb.__forumDb ??
  createClient(
    DATABASE_AUTH_TOKEN ? { url: DATABASE_URL, authToken: DATABASE_AUTH_TOKEN } : { url: DATABASE_URL }
  );
if (!globalForDb.__forumDb) globalForDb.__forumDb = db;

let ready: Promise<void> | null = null;

function init(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS posts (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          emotion_id TEXT,
          text TEXT NOT NULL,
          nickname TEXT,
          status TEXT NOT NULL DEFAULT 'published',
          created_at INTEGER NOT NULL,
          reaction_heart INTEGER NOT NULL DEFAULT 0,
          reaction_idea INTEGER NOT NULL DEFAULT 0,
          reaction_surprise INTEGER NOT NULL DEFAULT 0,
          moderated_by TEXT
        )
      `);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board_id)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)`);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS board_settings (
          board_id TEXT PRIMARY KEY,
          requires_approval INTEGER NOT NULL
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS admins (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          created_by TEXT
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
          token TEXT PRIMARY KEY,
          admin_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      // 방문객이 직접 가입하는 사용자 계정. 운영자(admins)와는 별개의 로그인 체계이며,
      // 임원/조합원/일반인 등급 구분과 임원 전용 관리 페이지(/manage)에 쓰입니다.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT,
          role TEXT NOT NULL DEFAULT 'general',
          created_at INTEGER NOT NULL,
          role_updated_by TEXT,
          role_updated_at INTEGER
        )
      `);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
    })();
  }
  return ready;
}

/** 모든 db 함수는 내부적으로 이 함수를 먼저 호출해 테이블이 준비됐는지 확인합니다. */
export async function withDb(): Promise<Client> {
  await init();
  return db;
}

export interface PostRow {
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

function toPost(row: Record<string, unknown>): PostRow {
  return {
    id: row.id as string,
    board_id: row.board_id as string,
    emotion_id: (row.emotion_id as string | null) ?? null,
    text: row.text as string,
    nickname: (row.nickname as string | null) ?? null,
    status: row.status as PostRow["status"],
    created_at: Number(row.created_at),
    reaction_heart: Number(row.reaction_heart),
    reaction_idea: Number(row.reaction_idea),
    reaction_surprise: Number(row.reaction_surprise),
    moderated_by: (row.moderated_by as string | null) ?? null,
  };
}

export async function boardRequiresApproval(boardId: string): Promise<boolean> {
  const c = await withDb();
  const rs = await c.execute({
    sql: `SELECT requires_approval FROM board_settings WHERE board_id = ?`,
    args: [boardId],
  });
  if (rs.rows.length) return !!Number(rs.rows[0].requires_approval);
  return false; // 기본값: 실시간 공개(승인 없음). 행사 전 관리자 페이지에서 보드별로 설정하세요.
}

export async function setBoardApproval(boardId: string, requiresApproval: boolean): Promise<void> {
  const c = await withDb();
  await c.execute({
    sql: `INSERT INTO board_settings (board_id, requires_approval) VALUES (?, ?)
          ON CONFLICT(board_id) DO UPDATE SET requires_approval = excluded.requires_approval`,
    args: [boardId, requiresApproval ? 1 : 0],
  });
}

export async function getBoardSettings(): Promise<Record<string, boolean>> {
  const c = await withDb();
  const rs = await c.execute(`SELECT board_id, requires_approval FROM board_settings`);
  const out: Record<string, boolean> = {};
  for (const r of rs.rows) out[r.board_id as string] = !!Number(r.requires_approval);
  return out;
}

export async function createPost(input: {
  boardId: BoardId | string;
  emotionId: string | null;
  text: string;
  nickname: string | null;
}): Promise<PostRow> {
  const c = await withDb();
  const id = nanoid(10);
  const status = (await boardRequiresApproval(input.boardId)) ? "pending" : "published";
  const created_at = Date.now();
  await c.execute({
    sql: `INSERT INTO posts (id, board_id, emotion_id, text, nickname, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, input.boardId, input.emotionId, input.text, input.nickname, status, created_at],
  });
  return (await getPost(id))!;
}

export async function getPost(id: string): Promise<PostRow | undefined> {
  const c = await withDb();
  const rs = await c.execute({ sql: `SELECT * FROM posts WHERE id = ?`, args: [id] });
  return rs.rows[0] ? toPost(rs.rows[0] as unknown as Record<string, unknown>) : undefined;
}

export async function listPublicPosts(boardId?: string): Promise<PostRow[]> {
  const c = await withDb();
  const rs =
    boardId && boardId !== "all"
      ? await c.execute({
          sql: `SELECT * FROM posts WHERE status = 'published' AND board_id = ? ORDER BY created_at DESC`,
          args: [boardId],
        })
      : await c.execute(`SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC`);
  return rs.rows.map((r) => toPost(r as unknown as Record<string, unknown>));
}

export async function listAllPosts(filter?: { boardId?: string; status?: string }): Promise<PostRow[]> {
  const c = await withDb();
  const clauses: string[] = [];
  const args: string[] = [];
  if (filter?.boardId && filter.boardId !== "all") {
    clauses.push("board_id = ?");
    args.push(filter.boardId);
  }
  if (filter?.status && filter.status !== "all") {
    clauses.push("status = ?");
    args.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rs = await c.execute({ sql: `SELECT * FROM posts ${where} ORDER BY created_at DESC`, args });
  return rs.rows.map((r) => toPost(r as unknown as Record<string, unknown>));
}

export async function countsByBoard(): Promise<Record<string, number>> {
  const c = await withDb();
  const rs = await c.execute(
    `SELECT board_id, COUNT(*) as n FROM posts WHERE status = 'published' GROUP BY board_id`
  );
  const out: Record<string, number> = {};
  for (const r of rs.rows) out[r.board_id as string] = Number(r.n);
  return out;
}

export async function pendingCount(): Promise<number> {
  const c = await withDb();
  const rs = await c.execute(`SELECT COUNT(*) as n FROM posts WHERE status = 'pending'`);
  return Number(rs.rows[0]?.n ?? 0);
}

const REACTION_COLUMN: Record<string, string> = {
  heart: "reaction_heart",
  idea: "reaction_idea",
  surprise: "reaction_surprise",
};

export async function addReaction(postId: string, type: string): Promise<PostRow | undefined> {
  const col = REACTION_COLUMN[type];
  if (!col) return undefined;
  const c = await withDb();
  await c.execute({
    sql: `UPDATE posts SET ${col} = ${col} + 1 WHERE id = ? AND status = 'published'`,
    args: [postId],
  });
  return getPost(postId);
}

export async function setPostStatus(
  id: string,
  status: "published" | "pending" | "hidden",
  moderatedBy: string | null
): Promise<void> {
  const c = await withDb();
  await c.execute({
    sql: `UPDATE posts SET status = ?, moderated_by = ? WHERE id = ?`,
    args: [status, moderatedBy, id],
  });
}

export async function deletePost(id: string): Promise<void> {
  const c = await withDb();
  await c.execute({ sql: `DELETE FROM posts WHERE id = ?`, args: [id] });
}

export function toCSV(rows: PostRow[]): string {
  const header = [
    "id",
    "board_id",
    "emotion_id",
    "nickname",
    "text",
    "status",
    "created_at_iso",
    "heart",
    "idea",
    "surprise",
    "moderated_by",
  ];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.board_id,
        r.emotion_id ?? "",
        r.nickname ?? "",
        r.text,
        r.status,
        new Date(r.created_at).toISOString(),
        r.reaction_heart,
        r.reaction_idea,
        r.reaction_surprise,
        r.moderated_by ?? "",
      ]
        .map(escape)
        .join(",")
    );
  }
  return "﻿" + lines.join("\n"); // BOM 포함 → 엑셀에서 한글 깨짐 방지
}
