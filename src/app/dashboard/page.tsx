import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { signOut } from "@/app/actions";
import { createClient } from "@/lib/supabase/server";

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
          正在验证登录状态…
        </main>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  // Keep request-dependent rendering inside the Suspense boundary.
  await connection();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/login");
  }

  const email =
    typeof data.claims.email === "string"
      ? data.claims.email
      : "已登录用户";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-12">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold tracking-wide text-indigo-600">
              SUPABASE AUTH STARTER
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
              个人工作台
            </h1>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
            >
              退出登录
            </button>
          </form>
        </header>

        <section className="mt-10 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-xl text-emerald-700">
            ✓
          </div>
          <h2 className="mt-6 text-2xl font-bold text-slate-900">
            你已成功登录
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            这是一个受 Supabase 身份验证保护的服务端页面。
          </p>
          <div className="mt-8 rounded-2xl bg-slate-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              当前登录账户
            </p>
            <p className="mt-2 break-all text-base font-medium text-slate-900">
              {email}
            </p>
          </div>
          <p className="mt-6 text-sm text-slate-500">
            <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700">
              返回登录页
            </Link>
            {" "}或使用右上角按钮退出账户。
          </p>
        </section>
      </div>
    </main>
  );
}