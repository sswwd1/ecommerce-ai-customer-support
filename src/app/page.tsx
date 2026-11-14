import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12">
      <section className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60 sm:p-12">
        <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white">
          S
        </div>
        <p className="text-sm font-semibold tracking-wide text-indigo-600">
          NEXT.JS 16 + SUPABASE
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          从这里开始，构建你的应用。
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-slate-500">
          一个基于 App Router 和 Supabase SSR 的身份验证示例，包含邮箱注册、登录、会话刷新和受保护的个人工作台。
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            创建账户
          </Link>
          <Link
            href="/login"
            className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            登录
          </Link>
        </div>
        <div className="mt-12 grid gap-4 border-t border-slate-100 pt-7 sm:grid-cols-3">
          <div>
            <p className="font-semibold text-slate-900">注册与登录</p>
            <p className="mt-1 text-sm text-slate-500">邮箱和密码身份验证</p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">SSR 会话</p>
            <p className="mt-1 text-sm text-slate-500">HttpOnly Cookie 会话管理</p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">路由保护</p>
            <p className="mt-1 text-sm text-slate-500">服务端验证用户身份</p>
          </div>
        </div>
      </section>
    </main>
  );
}