import { NextResponse } from "next/server";
import { getCurrentUser, listUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

/** 사용자 목록 — 임원만 조회할 수 있어요. */
export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  if (me.role !== "officer") return NextResponse.json({ error: "임원만 볼 수 있어요." }, { status: 403 });

  const users = await listUsers();
  return NextResponse.json({ users });
}
