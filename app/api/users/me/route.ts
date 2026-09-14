import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  return NextResponse.json({ user });
}
