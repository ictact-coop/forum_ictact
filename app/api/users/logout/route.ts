import { NextRequest, NextResponse } from "next/server";
import { USER_COOKIE, destroyUserSessionToken } from "@/lib/users";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(USER_COOKIE)?.value;
  if (token) await destroyUserSessionToken(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(USER_COOKIE);
  return res;
}
