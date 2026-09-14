import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import { withDb } from "./db";
import { hashPassword, verifyPassword } from "./password";

export const ADMIN_COOKIE = "forum_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12시간

export interface AdminRow {
  id: string;
  username: string;
  created_at: number;
  created_by: string | null;
}

/**
 * 운영자 계정이 하나도 없으면(최초 실행) 환경변수로 첫 계정을 만듭니다.
 * 이후에는 관리자 페이지에서 다른 운영자 계정을 추가/삭제할 수 있습니다.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const db = await withDb();
  const rs = await db.execute(`SELECT COUNT(*) as n FROM admins`);
  const n = Number(rs.rows[0]?.n ?? 0);
  if (n > 0) return;

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "digital-chat-2026";
  await db.execute({
    sql: `INSERT INTO admins (id, username, password_hash, created_at, created_by) VALUES (?, ?, ?, ?, NULL)`,
    args: [nanoid(12), username, hashPassword(password), Date.now()],
  });
  if (!process.env.ADMIN_PASSWORD) {
    // eslint-disable-next-line no-console
    console.warn(
      `[forum] ADMIN_PASSWORD가 설정되지 않아 기본 운영자 계정(${username}/digital-chat-2026)이 생성됐습니다. 행사 전에 반드시 비밀번호를 바꾸세요.`
    );
  }
}

export async function listAdmins(): Promise<AdminRow[]> {
  await ensureBootstrapAdmin();
  const db = await withDb();
  const rs = await db.execute(`SELECT id, username, created_at, created_by FROM admins ORDER BY created_at ASC`);
  return rs.rows.map((r) => ({
    id: r.id as string,
    username: r.username as string,
    created_at: Number(r.created_at),
    created_by: (r.created_by as string | null) ?? null,
  }));
}

export async function createAdmin(
  username: string,
  password: string,
  createdBy: string
): Promise<AdminRow | { error: string }> {
  const db = await withDb();
  const clean = username.trim();
  if (clean.length < 2 || clean.length > 30) return { error: "아이디는 2~30자로 입력해주세요." };
  if (password.length < 6) return { error: "비밀번호는 6자 이상으로 입력해주세요." };

  const existing = await db.execute({ sql: `SELECT id FROM admins WHERE username = ?`, args: [clean] });
  if (existing.rows.length) return { error: "이미 있는 아이디예요." };

  const id = nanoid(12);
  const created_at = Date.now();
  await db.execute({
    sql: `INSERT INTO admins (id, username, password_hash, created_at, created_by) VALUES (?, ?, ?, ?, ?)`,
    args: [id, clean, hashPassword(password), created_at, createdBy],
  });
  return { id, username: clean, created_at, created_by: createdBy };
}

export async function deleteAdmin(id: string): Promise<{ ok: true } | { error: string }> {
  const db = await withDb();
  const countRs = await db.execute(`SELECT COUNT(*) as n FROM admins`);
  if (Number(countRs.rows[0]?.n ?? 0) <= 1) {
    return { error: "마지막 남은 운영자 계정은 삭제할 수 없어요." };
  }
  await db.execute({ sql: `DELETE FROM admins WHERE id = ?`, args: [id] });
  await db.execute({ sql: `DELETE FROM admin_sessions WHERE admin_id = ?`, args: [id] });
  return { ok: true };
}

export async function verifyAdminCredentials(username: string, password: string): Promise<AdminRow | null> {
  await ensureBootstrapAdmin();
  const db = await withDb();
  const rs = await db.execute({
    sql: `SELECT id, username, password_hash, created_at, created_by FROM admins WHERE username = ?`,
    args: [username.trim()],
  });
  const row = rs.rows[0];
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash as string)) return null;
  return {
    id: row.id as string,
    username: row.username as string,
    created_at: Number(row.created_at),
    created_by: (row.created_by as string | null) ?? null,
  };
}

export async function createAdminSession(adminId: string): Promise<string> {
  const db = await withDb();
  const token = nanoid(32);
  await db.execute({
    sql: `INSERT INTO admin_sessions (token, admin_id, created_at) VALUES (?, ?, ?)`,
    args: [token, adminId, Date.now()],
  });
  return token;
}

export async function destroySessionToken(token: string): Promise<void> {
  const db = await withDb();
  await db.execute({ sql: `DELETE FROM admin_sessions WHERE token = ?`, args: [token] });
}

/** 현재 요청의 운영자 세션을 확인하고, 로그인돼 있으면 계정 정보를 반환합니다. */
export async function getCurrentAdmin(): Promise<{ id: string; username: string } | null> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return null;

  const db = await withDb();
  const rs = await db.execute({
    sql: `SELECT s.admin_id as admin_id, s.created_at as created_at, a.username as username
          FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
          WHERE s.token = ?`,
    args: [token],
  });
  const row = rs.rows[0];
  if (!row) return null;
  if (Date.now() - Number(row.created_at) > SESSION_TTL_MS) {
    await destroySessionToken(token);
    return null;
  }
  return { id: row.admin_id as string, username: row.username as string };
}
