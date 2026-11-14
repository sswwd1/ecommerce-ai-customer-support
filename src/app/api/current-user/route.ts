import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error || !data?.claims?.sub) {
      return NextResponse.json(
        { error: "登录会话无效，请重新登录。" },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    return NextResponse.json(
      { userId: data.claims.sub },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "验证登录状态失败。" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}