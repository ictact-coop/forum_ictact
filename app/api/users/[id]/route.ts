import { NextRequest, NextResponse } from "next/server";
import { USER_ROLES, deleteUser, getCurrentUser, setUserRole } from "@/lib/users";

/** 사용자 등급 변경 — 임원만 할 수 있어요. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  if (me.role !== "officer") return NextResponse.json({ error: "임원만 등급을 바꿀 수 있어요." }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  const { role } = (body ?? {}) as Record<string, unknown>;
  if (typeof role !== "string" || !USER_ROLES.includes(role as (typeof USER_ROLES)[number])) {
    return NextResponse.json({ error: "올바르지 않은 등급이에요." }, { status: 400 });
  }

  const { id } = await params;
  const result = await setUserRole(id, role as (typeof USER_ROLES)[number], me.username);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ user: result });
}

/** 사용자 계정 삭제 — 임원만 할 수 있어요. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  if (me.role !== "officer") return NextResponse.json({ error: "임원만 계정을 삭제할 수 있어요." }, { status: 403 });

  const { id } = await params;
  if (id === me.id) {
    return NextResponse.json({ error: "본인 계정은 여기서 삭제할 수 없어요." }, { status: 400 });
  }

  const result = await deleteUser(id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
