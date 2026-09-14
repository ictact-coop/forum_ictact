import { NextRequest, NextResponse } from "next/server";
import { USER_COOKIE, createUserSession, verifyUserCredentials } from "@/lib/users";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  const { username, password } = (body ?? {}) as Record<string, unknown>;

  if (typeof username !== "string" || typeof password !== "string" || !username.trim()) {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력해주세요." }, { status: 400 });
  }

  const user = await verifyUserCredentials(username, password);
  if (!user) {
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않아요." }, { status: 401 });
  }

  const token = await createUserSession(user.id);
  const res = NextResponse.json({ user });
  res.cookies.set(USER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
