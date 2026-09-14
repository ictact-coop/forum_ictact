import { NextRequest, NextResponse } from "next/server";
import { USER_COOKIE, createUserSession, registerUser } from "@/lib/users";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  const { username, password, displayName } = (body ?? {}) as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력해주세요." }, { status: 400 });
  }

  const result = await registerUser(username, password, typeof displayName === "string" ? displayName : null);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const token = await createUserSession(result.id);
  const res = NextResponse.json({ user: result });
  res.cookies.set(USER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
