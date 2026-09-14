"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { ApiUser } from "@/lib/types";
import { relativeTimeKo } from "@/lib/time";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ROLE_LABEL: Record<string, string> = {
  officer: "임원",
  member: "조합원",
  general: "일반인",
};
const ROLE_STYLE: Record<string, string> = {
  officer: "bg-brand-50 text-brand-600",
  member: "bg-emerald-100 text-emerald-700",
  general: "bg-black/[0.06] text-ink/50",
};
const ROLE_ORDER = ["officer", "member", "general"];

interface Me {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
}

export default function ManagePage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = 확인 중

  useEffect(() => {
    fetch("/api/users/me")
      .then(async (r) => (r.ok ? setMe((await r.json()).user) : setMe(null)))
      .catch(() => setMe(null));
  }, []);

  async function refreshMe() {
    const r = await fetch("/api/users/me");
    setMe(r.ok ? (await r.json()).user : null);
  }

  async function handleLogout() {
    await fetch("/api/users/logout", { method: "POST" });
    setMe(null);
  }

  if (me === undefined) {
    return <div className="p-10 text-center text-ink/40">불러오는 중...</div>;
  }

  if (!me) {
    return <AuthGate onAuthed={refreshMe} />;
  }

  return <ManageDashboard me={me} onLogout={handleLogout} />;
}

function AuthGate({ onAuthed }: { onAuthed: () => void }) {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const url = tab === "login" ? "/api/users/login" : "/api/users/signup";
    const body =
      tab === "login" ? { username, password } : { username, password, displayName };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || (tab === "login" ? "로그인에 실패했어요." : "가입에 실패했어요."));
      return;
    }
    onAuthed();
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center px-6">
      <h1 className="text-[22px] font-extrabold text-ink">사용자 관리 페이지</h1>
      <p className="mt-1 text-[13.5px] text-ink/45">
        임원 · 조합원 · 일반인 등급을 관리하는 곳이에요. 계정이 없다면 먼저 회원가입해주세요.
      </p>

      <div className="mt-6 flex rounded-xl bg-black/[0.04] p-1">
        <button
          onClick={() => setTab("login")}
          className={`flex-1 rounded-lg py-2 text-[13.5px] font-bold ${
            tab === "login" ? "bg-white text-ink shadow-note" : "text-ink/40"
          }`}
        >
          로그인
        </button>
        <button
          onClick={() => setTab("signup")}
          className={`flex-1 rounded-lg py-2 text-[13.5px] font-bold ${
            tab === "signup" ? "bg-white text-ink shadow-note" : "text-ink/40"
          }`}
        >
          회원가입
        </button>
      </div>

      <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="아이디"
          className="rounded-xl border border-black/10 bg-white px-4 py-3 text-[14px] outline-none focus:border-brand-300"
          autoFocus
        />
        {tab === "signup" && (
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="이름/닉네임 (선택)"
            className="rounded-xl border border-black/10 bg-white px-4 py-3 text-[14px] outline-none focus:border-brand-300"
          />
        )}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호 (6자 이상)"
          className="rounded-xl border border-black/10 bg-white px-4 py-3 text-[14px] outline-none focus:border-brand-300"
        />
        {error && <p className="text-[13px] text-rose-500">{error}</p>}
        <button
          disabled={busy}
          className="rounded-xl bg-ink px-4 py-3 text-[14px] font-bold text-white disabled:opacity-50"
        >
          {tab === "login" ? "로그인" : "가입하고 시작하기"}
        </button>
      </form>

      {tab === "signup" && (
        <p className="mt-4 text-center text-[12px] text-ink/35">
          가입 직후 등급은 &lsquo;일반인&rsquo;이에요. 임원이 이 페이지에서 등급을 올려줄 수 있어요.
          (가장 처음 가입하는 사람은 자동으로 &lsquo;임원&rsquo;이 돼요.)
        </p>
      )}
      <Link href="/" className="mt-4 text-center text-[12.5px] text-ink/35 hover:text-ink/60">
        ← 참여 화면으로 돌아가기
      </Link>
    </div>
  );
}

function ManageDashboard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const key = "/api/users";
  const { data, error } = useSWR<{ users: ApiUser[]; error?: string }>(key, fetcher);
  const [roleFilter, setRoleFilter] = useState("all");
  const isOfficer = me.role === "officer";

  const users = (data?.users ?? []).filter((u) => roleFilter === "all" || u.role === roleFilter);

  async function changeRole(id: string, role: string) {
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(json.error || "등급 변경에 실패했어요.");
      return;
    }
    mutate(key);
  }

  async function removeUser(id: string) {
    if (!confirm("이 계정을 삭제할까요? 되돌릴 수 없어요.")) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(json.error || "삭제에 실패했어요.");
      return;
    }
    mutate(key);
  }

  return (
    <div className="mx-auto min-h-[100dvh] max-w-4xl px-5 pb-16 pt-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold text-ink">사용자 관리 페이지</h1>
          <p className="mt-0.5 text-[13px] text-ink/45">
            <span className="font-semibold text-ink/70">{me.display_name || me.username}</span>님으로 로그인 ·{" "}
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${ROLE_STYLE[me.role]}`}>
              {ROLE_LABEL[me.role] ?? me.role}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/board" className="text-[13px] text-ink/40 hover:text-ink/70">
            게시판
          </Link>
          <button onClick={onLogout} className="text-[13px] text-ink/40 hover:text-ink/70">
            로그아웃
          </button>
        </div>
      </header>

      {!isOfficer ? (
        <section className="rounded-2xl border border-black/[0.06] bg-white p-6 text-center shadow-note">
          <p className="text-[14px] font-semibold text-ink/70">임원만 사용자 목록과 등급을 관리할 수 있어요.</p>
          <p className="mt-1 text-[13px] text-ink/45">
            현재 내 등급은 &lsquo;{ROLE_LABEL[me.role] ?? me.role}&rsquo;이에요. 등급 변경이 필요하면 임원에게
            요청해주세요.
          </p>
        </section>
      ) : (
        <>
          <section className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-note">
            <h2 className="text-[14px] font-bold text-ink/80">
              사용자 목록 <span className="text-ink/40">({data?.users.length ?? 0}명)</span>
            </h2>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-full border border-black/10 bg-white px-3 py-2 text-[13px]"
            >
              <option value="all">전체 등급</option>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </section>

          {error && <p className="text-[13px] text-rose-500">사용자 목록을 불러오지 못했어요.</p>}

          <div className="flex flex-col gap-2.5">
            {users.length === 0 && <p className="py-10 text-center text-[13.5px] text-ink/35">사용자가 없어요.</p>}
            {users.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-note"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[14px] font-semibold text-ink/85">
                      {u.display_name || u.username}
                      {u.id === me.id && <span className="ml-1.5 text-[11px] text-brand-600">(나)</span>}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ROLE_STYLE[u.role]}`}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink/40">
                    @{u.username} · {relativeTimeKo(u.created_at)} 가입
                    {u.role_updated_by && <> · 등급 변경: {u.role_updated_by}</>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    value={u.role}
                    onChange={(e) => changeRole(u.id, e.target.value)}
                    className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12.5px]"
                  >
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  {u.id !== me.id && (
                    <button
                      onClick={() => removeUser(u.id)}
                      className="rounded-full bg-rose-50 px-3 py-1.5 text-[12px] font-semibold text-rose-600"
                    >
                      삭제
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
