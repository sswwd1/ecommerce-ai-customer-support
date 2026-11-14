import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";


export async function GET() {
  const cookieStore = await cookies();
  const authCookieNames = cookieStore
    .getAll()
    .map((cookie) => cookie.name)
    .filter((name) => name.startsWith("sb-"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  return NextResponse.json(
    {
      host: "localhost/127.0.0.1 origin is determined by the browser address bar",
      authCookieNames,
      hasAuthCookie: authCookieNames.length > 0,
      hasClaims: Boolean(data?.claims),
      error: error
        ? {
            name: error.name,
            message: error.message,
            status: "status" in error ? error.status : null,
          }
        : null,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}