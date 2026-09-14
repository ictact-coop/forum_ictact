import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import { withDb } from "./db";
import { hashPassword, verifyPassword } from "./password";

export const USER_COOKIE = "forum_user_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30일

/** officer(임원) / member(조합원) / general(일반인) */
export type UserRole = "officer" | "member" | "general";

export const USER_ROLES: UserRole[] = ["officer", "member", "general"];

export const ROLE_LABEL: Record<UserRole, string> = {
  officer: "임원",
  member: "조합원",
  general: "일반인",
};

function isUserRole(v: unknown): v is UserRole {
  return v === "officer" || v === "member" || v === "general";
}

export interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: UserRole;
  created_at: number;
  role_updated_by: string | null;
  role_updated_at: number | null;
}

function toUser(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as string,
    username: row.username as string,
    display_name: (row.display_name as string | null) ?? null,
    role: isUserRole(row.role) ? row.role : "general",
    created_at: Number(row.created_at),
    role_updated_by: (row.role_updated_by as string | null) ?? null,
    role_updated_at: row.role_updated_at != null ? Number(row.role_updated_at) : null,
  };
}

/**
 * 방문객 회원가입. 새 계정은 원칙적으로 '일반인'으로 시작하고, 등급은 임원이 관리 페이지
 * (/manage)에서 올려줍니다. 단, 가입자가 아직 한 명도 없을 때(최초 실행)의 첫 가입자는
 * 예외적으로 '임원'이 되어, 그 사람이 이후 다른 사람들의 등급을 관리할 수 있게 합니다.
 */
export async function registerUser(
  username: string,
  password: string,
  displayName: string | null
): Promise<UserRow | { error: string }> {
  const db = await withDb();
  const clean = username.trim();
  if (clean.length < 2 || clean.length > 30) return { error: "아이디는 2~30자로 입력해주세요." };
  if (password.length < 6) return { error: "비밀번호는 6자 이상으로 입력해주세요." };

  const existing = await db.execute({ sql: `SELECT id FROM users WHERE username = ?`, args: [clean] });
  if (existing.rows.length) return { error: "이미 있는 아이디예요." };

  const countRs = await db.execute(`SELECT COUNT(*) as n FROM users`);
  const isFirstUser = Number(countRs.rows[0]?.n ?? 0) === 0;
  const role: UserRole = isFirstUser ? "officer" : "general";

  const id = nanoid(12);
  const created_at = Date.now();
  const cleanDisplayName = displayName?.trim() || null;
  await db.execute({
    sql: `INSERT INTO users (id, username, password_hash, display_name, role, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, clean, hashPassword(password), cleanDisplayName, role, created_at],
  });
  return {
    id,
    username: clean,
    display_name: cleanDisplayName,
    role,
    created_at,
    role_updated_by: null,
    role_updated_at: null,
  };
}

export async function verifyUserCredentials(username: string, password: string): Promise<UserRow | null> {
  const db = await withDb();
  const rs = await db.execute({ sql: `SELECT * FROM users WHERE username = ?`, args: [username.trim()] });
  const row = rs.rows[0];
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash as string)) return null;
  return toUser(row as unknown as Record<string, unknown>);
}

export async function createUserSession(userId: string): Promise<string> {
  const db = await withDb();
  const token = nanoid(32);
  await db.execute({
    sql: `INSERT INTO user_sessions (token, user_id, created_at) VALUES (?, ?, ?)`,
    args: [token, userId, Date.now()],
  });
  return token;
}

export async function destroyUserSessionToken(token: string): Promise<void> {
  const db = await withDb();
  await db.execute({ sql: `DELETE FROM user_sessions WHERE token = ?`, args: [token] });
}

/** 현재 요청의 사용자 세션을 확인하고, 로그인돼 있으면 계정 정보를 반환합니다. */
export async function getCurrentUser(): Promise<UserRow | null> {
  const store = await cookies();
  const token = store.get(USER_COOKIE)?.value;
  if (!token) return null;

  const db = await withDb();
  const rs = await db.execute({
    sql: `SELECT u.*, s.created_at as session_created_at
          FROM user_sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token = ?`,
    args: [token],
  });
  const row = rs.rows[0];
  if (!row) return null;
  if (Date.now() - Number(row.session_created_at) > SESSION_TTL_MS) {
    await destroyUserSessionToken(token);
    return null;
  }
  return toUser(row as unknown as Record<string, unknown>);
}

export async function listUsers(): Promise<UserRow[]> {
  const db = await withDb();
  const rs = await db.execute(`SELECT * FROM users ORDER BY created_at ASC`);
  return rs.rows.map((r) => toUser(r as unknown as Record<string, unknown>));
}

async function officerCount(): Promise<number> {
  const db = await withDb();
  const rs = await db.execute(`SELECT COUNT(*) as n FROM users WHERE role = 'officer'`);
  return Number(rs.rows[0]?.n ?? 0);
}

/** 임원이 다른 계정의 등급(임원/조합원/일반인)을 바꿉니다. 마지막 임원은 강등할 수 없어요. */
export async function setUserRole(
  id: string,
  role: UserRole,
  updatedBy: string
): Promise<UserRow | { error: string }> {
  const db = await withDb();
  const rs = await db.execute({ sql: `SELECT * FROM users WHERE id = ?`, args: [id] });
  const row = rs.rows[0];
  if (!row) return { error: "존재하지 않는 계정이에요." };
  const current = toUser(row as unknown as Record<string, unknown>);

  if (current.role === "officer" && role !== "officer" && (await officerCount()) <= 1) {
    return { error: "마지막 남은 임원 계정은 등급을 바꿀 수 없어요." };
  }

  const role_updated_at = Date.now();
  await db.execute({
    sql: `UPDATE users SET role = ?, role_updated_by = ?, role_updated_at = ? WHERE id = ?`,
    args: [role, updatedBy, role_updated_at, id],
  });
  return { ...current, role, role_updated_by: updatedBy, role_updated_at };
}

/** 임원이 계정을 삭제합니다. 마지막 임원 계정은 삭제할 수 없어요. */
export async function deleteUser(id: string): Promise<{ ok: true } | { error: string }> {
  const db = await withDb();
  const rs = await db.execute({ sql: `SELECT role FROM users WHERE id = ?`, args: [id] });
  const row = rs.rows[0];
  if (!row) return { error: "존재하지 않는 계정이에요." };
  if (row.role === "officer" && (await officerCount()) <= 1) {
    return { error: "마지막 남은 임원 계정은 삭제할 수 없어요." };
  }
  await db.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [id] });
  await db.execute({ sql: `DELETE FROM user_sessions WHERE user_id = ?`, args: [id] });
  return { ok: true };
}
