"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function EmbeddingTestPage() {
  const [result, setResult] = useState("尚未测试");
  const [loading, setLoading] = useState(false);

  async function runTest() {
    setLoading(true);
    setResult("正在调用 Embedding API…");
    try {
      const supabase = createClient();
      const { data: basicData, error: basicError } = await supabase.functions.invoke("embedding-test", {
        body: { test: true },
      });
      if (basicError) throw basicError;
      const { data: batchData, error: batchError } = await supabase.functions.invoke<{
        count?: number;
        dimensions?: number;
        model?: string;
        error?: string;
      }>("embed-knowledge-chunks", {
        body: { inputs: ["Supabase RAG 中文向量测试一。", "这是第二条用于批量 Embedding 的测试文本。"] },
      });
      if (batchError) throw batchError;
      if (batchData?.error) throw new Error(batchData.error);
      setResult(JSON.stringify({
        singleEmbedding: basicData,
        batchEmbedding: {
          ok: batchData?.count === 2 && batchData?.dimensions === 1024,
          count: batchData?.count,
          dimensions: batchData?.dimensions,
          model: batchData?.model,
        },
      }, null, 2));
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "48px auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1>Embedding API 连通性测试</h1>
      <p>此页面只显示测试状态和向量维度，不会显示 API Key。</p>
      <button onClick={runTest} disabled={loading} style={{ padding: "10px 18px", cursor: "pointer" }}>
        {loading ? "测试中…" : "测试 SiliconFlow Embedding"}
      </button>
      <pre style={{ whiteSpace: "pre-wrap", marginTop: 24, padding: 16, background: "#f3f4f6", borderRadius: 8 }}>
        {result}
      </pre>
    </main>
  );
}