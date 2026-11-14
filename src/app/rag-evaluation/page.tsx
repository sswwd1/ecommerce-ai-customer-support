"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import dataset from "../../../tests/rag-evaluation.json";

type Case = { id:string; category:string; question:string; turns?:string[]; expected_facts:string[]; must_not_claim:string[]; expected_source:string };
type Chunk = { chunk_id:string; title:string; chunk_index:number; content:string; similarity:number };
type Review = { accuracy:number; completeness:number; faithfulness:number; uncertainty:number; unsupportedClaims:string[]; missingFacts:string[]; rationale:string; verdict:"pass"|"review" };
type Result = { test:Case; answer:string; sources:Chunk[]; retrieval:boolean; source:boolean; safe:boolean; facts:{fact:string;passed:boolean}[]; review?:Review; reviewError?:string; reviewSkipped?:boolean; error?:string };
type ComparisonResult = { k:number; testId:string; retrievalCount:number; uniqueSourceCount:number; answer:string; sources:Chunk[]; facts:{fact:string;passed:boolean}[]; source:boolean; safe:boolean; factsPassed:number; factsTotal:number; review?:Review; elapsedMs:number; error?:string };

const factPatterns:Record<string,RegExp[]> = {
 "RAG-001":[/48\s*小时/,/发货/],
 "RAG-002":[/48\s*小时/,/不能|无法|不能确定|不能判断/,/人工客服/,/订单编号/],
 "RAG-003":[/48\s*小时/,/通常|一般|没有说明|不能确认/],
 "RAG-004":[/48\s*小时/,/人工客服/,/订单编号/,/核实|确认/],
 "RAG-005":[/2\s*(到|至|[-—])\s*5\s*天/,/地区/,/天气|物流/],
 "RAG-006":[/原支付渠道/,/支付渠道/],
 "RAG-007":[/48\s*小时/,/2\s*(到|至|[-—])\s*5\s*天/,/地区|天气|物流/],
 "RAG-008":[/没有物流信息|物流信息/,/不能|无法|不能确定|不能判断/],
 "RAG-009":[/无法直接查看|不能直接查看|无法查看/,/人工客服/,/订单编号/],
 "RAG-010":[/原支付渠道/,/支付渠道/],
 "RAG-011":[/(?=.*48\s*小时)(?=.*发货)/,/(?=.*人工客服)(?=.*订单编号)(?=.*核实)/,/(?=.*原支付渠道)(?=.*支付渠道)/],
 "RAG-012":[/(?=.*48\s*小时)(?=.*发货)/,/(?=.*没有承诺|没有明确|并非|不能确认|通常)(?=.*24小时|24\s*小时)/],
 "RAG-013":[/(?=.*(?:没有说明|没有提供|未说明|未提供|没有规定|未规定))(?=.*(?:物流信息|物流节点|物流各节点))(?=.*(?:生成|更新|标准更新时间|更新时间))/,/(?=.*(?:不能|无法))(?=.*(?:判断|推断|认定))(?=.*(?:发货|揽收))/],
 "RAG-014":[/原支付渠道|原支付方式|原路退回/,/(?=.*支付渠道)(?=.*以.*为准|取决于|决定)/,/(?=.*没有承诺|没有说明|无法确认|不能确认|不能保证|不保证|并未承诺)(?=.*24\s*小时)/],
};
function checkFacts(test:Case,answer:string) {
 const normalized=answer.replace(/\s+/g," ");
 return test.expected_facts.map((fact,index)=>({fact,passed:!!factPatterns[test.id]?.[index]?.test(normalized)}));
}
function checkSafety(test:Case,answer:string) {
 const lower=answer.toLowerCase();
 return !test.must_not_claim.some(term=>{
  const target=term.toLowerCase();
  let index=lower.indexOf(target);
  while(index>=0) {
   const prefix=lower.slice(Math.max(0,index-40),index);
   if(!/(不能|无法|不可|不应|并非|不是|不能仅凭|无法仅凭|不能据此|无法据此)/.test(prefix)) return true;
   index=lower.indexOf(target,index+target.length);
  }
  return false;
 });
}
function basicPass(r:Result) {
 return r.retrieval&&r.source&&r.safe&&r.facts.length>0&&r.facts.every(f=>f.passed);
}
function allPass(r:Result) { return basicPass(r)&&(r.reviewSkipped||(!!r.review&&r.review.verdict==="pass"&&!r.reviewError)); }

async function invokeIndependentReview(supabase:ReturnType<typeof createClient>, payload:{question:string;answer:string;expectedFacts:string[];sources:{title:string;content:string}[]}) {
 let lastError="独立评审请求失败。";
 for(let attempt=0;attempt<2;attempt++) {
  const {data,error}=await supabase.functions.invoke("evaluate-rag-answer",{body:payload});
  if(!error&&!data?.error&&data?.review) return data.review as Review;
  if(error) {
   lastError=error.message;
   const context=(error as {context?:unknown}).context;
   if(context instanceof Response) {
    try { const body=await context.clone().json(); if(body?.error) lastError=String(body.error); }
    catch { lastError=error.message+"（HTTP "+context.status+"）"; }
   }
  } else if(data?.error) lastError=String(data.error);
  else lastError="独立评审返回格式无效。";
  if(attempt===0) await new Promise(resolve=>setTimeout(resolve,800));
 }
 throw new Error(lastError);
}

export default function RagEvaluationPage() {
 const [running,setRunning]=useState(false);
 const [lowCostMode,setLowCostMode]=useState(true);
 const [reviewingId,setReviewingId]=useState<string|null>(null);
 const [progress,setProgress]=useState(0);
 const [runTotal,setRunTotal]=useState(dataset.cases.length);
 const [results,setResults]=useState<Result[]>([]);
 const [comparisonRunning,setComparisonRunning]=useState(false);
 const [comparisonProgress,setComparisonProgress]=useState(0);
 const [comparisonResults,setComparisonResults]=useState<ComparisonResult[]>([]);
 const [comparisonMessage,setComparisonMessage]=useState("");
 const [message,setMessage]=useState("");
 async function run(selectedOnly=false) {
  if(running)return;
  const tests=(dataset.cases as Case[]).filter(test=>!selectedOnly||["RAG-013"].includes(test.id));
  setRunning(true);setProgress(0);setRunTotal(tests.length);setResults([]);setMessage("正在验证登录…");
  const supabase=createClient();const done:Result[]=[];
  try {
   const authRes=await fetch("/api/current-user",{cache:"no-store",credentials:"same-origin"});
   const auth=await authRes.json();
   if(!authRes.ok||!auth.userId)throw new Error(auth.error||"请先登录。");
   const {data:docs,error:docsError}=await supabase.from("knowledge_documents").select("id,title").eq("user_id",auth.userId);
   if(docsError)throw docsError;if(!docs?.length)throw new Error("请先上传知识库资料。");
   for(let i=0;i<tests.length;i++){
    const test=tests[i];setMessage(`正在测试 ${test.id}：生成回答并进行独立评审`);
    let result:Result;
    try{
     const history:{role:"user"|"assistant";content:string}[]=[];
     const collectedSources:Chunk[]=[];
     const answerParts:string[]=[];
     const questions=test.turns??[test.question];
     for(let turnIndex=0;turnIndex<questions.length;turnIndex++){
      const turnQuestion=questions[turnIndex];
      const {data:emb,error:embErr}=await supabase.functions.invoke("embed-knowledge-chunks",{body:{inputs:[turnQuestion]}});
      if(embErr)throw embErr;const vector=emb?.embeddings?.[0];
      if(!Array.isArray(vector)||vector.length!==1024)throw new Error("问题向量无效。");
      const {data:matches,error:matchErr}=await supabase.rpc("match_knowledge_chunks",{query_embedding:vector,match_count:5});
      if(matchErr)throw matchErr;const turnSources=(matches??[]) as Chunk[];
      for(const item of turnSources)if(!collectedSources.some(existing=>existing.chunk_id===item.chunk_id))collectedSources.push(item);
      const {data:ai,error:aiErr}=await supabase.functions.invoke("hello-world",{body:{
       question:turnQuestion,history:[...history],knowledgeContext:turnSources.map(s=>({title:s.title,chunkIndex:s.chunk_index,content:s.content}))
      }});
      if(aiErr)throw aiErr;if(ai?.error)throw new Error(ai.error);
      const turnAnswer=String(ai?.answer??"");if(!turnAnswer.trim())throw new Error("DeepSeek 未返回回答。");
      answerParts.push(test.turns?`第${turnIndex+1}轮用户：${turnQuestion}\n第${turnIndex+1}轮客服：${turnAnswer}`:turnAnswer);
      history.push({role:"user",content:turnQuestion},{role:"assistant",content:turnAnswer});
     }
     const answer=answerParts.join("\n\n");
     const sources=collectedSources;
     const lower=answer.toLowerCase();
     const reviewQuestion=test.turns?test.turns.map((q,i)=>`第${i+1}轮：${q}`).join("\n"):test.question;
     result={test,answer,sources,retrieval:sources.length>0,source:sources.some(s=>s.title===test.expected_source),
      safe:checkSafety(test,answer),facts:checkFacts(test,answer)};
     // 低成本模式：基础检查全部通过时跳过独立评审；有问题的题目仍调用评审模型。
     if(lowCostMode&&basicPass(result)) {
      result.reviewSkipped=true;
     } else {
      try {
       result.review=await invokeIndependentReview(supabase,{
        question:reviewQuestion,answer,expectedFacts:test.expected_facts,
        sources:sources.map(s=>({title:s.title,content:s.content}))
       });
      } catch(judgeError) {
       result.reviewError=judgeError instanceof Error?judgeError.message:"独立评审失败，请稍后重试。";
      }
     }
    }catch(e){result={test,answer:"",sources:[],retrieval:false,source:false,safe:false,facts:[],error:e instanceof Error?e.message:"执行失败"};}
    done.push(result);setResults([...done]);setProgress(i+1);
   }
   const passed=done.filter(allPass).length;
   const judgeFailed=done.filter(x=>!x.error&&!x.review&&!x.reviewSkipped).length;
   setMessage(`执行完成：${done.length} 道题；${passed} 道通过${lowCostMode?"基础检查（低成本模式，合格题跳过独立评审）":"基础检查和独立评审"}；${done.length-passed} 道需要复核（其中 ${judgeFailed} 道评审未成功返回）。`);
  }catch(e){setMessage(e instanceof Error?e.message:"评估启动失败。");}
  finally{setRunning(false);}
 }
 async function runTopKComparison() {
  if(running||comparisonRunning)return;
  setComparisonRunning(true);setComparisonProgress(0);setComparisonResults([]);
  setComparisonMessage("正在准备 Top-K 对比实验…");
  const supabase=createClient();const completed:ComparisonResult[]=[];
  const tests=dataset.cases as Case[];const ks=[3,5,10];
  try {
   const authRes=await fetch("/api/current-user",{cache:"no-store",credentials:"same-origin"});
   const auth=await authRes.json();
   if(!authRes.ok||!auth.userId)throw new Error(auth.error||"请先登录。");
   const {data:docs,error:docsError}=await supabase.from("knowledge_documents").select("id").eq("user_id",auth.userId);
   if(docsError)throw docsError;if(!docs?.length)throw new Error("请先上传知识库资料。");
   for(const k of ks){
    for(const test of tests){
     const started=Date.now();
     setComparisonMessage(`正在比较 Top-${k}：${test.id}`);
     try{
      const history:{role:"user"|"assistant";content:string}[]=[];
      const allSources:Chunk[]=[];const answerParts:string[]=[];let totalRetrieved=0;
      const questions=test.turns??[test.question];
      for(const q of questions){
       const {data:emb,error:embErr}=await supabase.functions.invoke("embed-knowledge-chunks",{body:{inputs:[q]}});
       if(embErr)throw embErr;const vector=emb?.embeddings?.[0];
       if(!Array.isArray(vector)||vector.length!==1024)throw new Error("问题向量无效。");
       const {data:matches,error:matchErr}=await supabase.rpc("match_knowledge_chunks",{query_embedding:vector,match_count:k});
       if(matchErr)throw matchErr;const sources=(matches??[]) as Chunk[];totalRetrieved+=sources.length;
       for(const s of sources)if(!allSources.some(x=>x.chunk_id===s.chunk_id))allSources.push(s);
       const {data:ai,error:aiErr}=await supabase.functions.invoke("hello-world",{body:{
        question:q,history:[...history],knowledgeContext:sources.map(s=>({title:s.title,chunkIndex:s.chunk_index,content:s.content}))
       }});
       if(aiErr)throw aiErr;if(ai?.error)throw new Error(ai.error);
       const answer=String(ai?.answer??"");if(!answer.trim())throw new Error("DeepSeek 未返回回答。");
       answerParts.push(test.turns?(`用户：${q}\n客服：${answer}`):answer);
       history.push({role:"user",content:q},{role:"assistant",content:answer});
      }
      const answer=answerParts.join("\n\n");
      const facts=checkFacts(test,answer);
      const safe=checkSafety(test,answer);
      let review:Review|undefined;
      try{
       review=await invokeIndependentReview(supabase,{
        question:test.turns?test.turns.join("\n"):test.question,answer,expectedFacts:test.expected_facts,
        sources:allSources.map(s=>({title:s.title,content:s.content}))
       });
      }catch(e){throw new Error("独立评审失败："+(e instanceof Error?e.message:"未知错误"));}
      completed.push({k,testId:test.id,retrievalCount:totalRetrieved,uniqueSourceCount:allSources.length,answer,sources:allSources,facts,source:allSources.some(s=>s.title===test.expected_source),
       safe,factsPassed:facts.filter(f=>f.passed).length,factsTotal:facts.length,review,elapsedMs:Date.now()-started});
     }catch(e){
      completed.push({k,testId:test.id,retrievalCount:0,uniqueSourceCount:0,answer:"",sources:[],facts:[],source:false,safe:false,factsPassed:0,factsTotal:test.expected_facts.length,
       elapsedMs:Date.now()-started,error:e instanceof Error?e.message:"执行失败"});
     }
     setComparisonResults([...completed]);setComparisonProgress(completed.length);
    }
   }
   const total=completed.length;const passed=completed.filter(x=>!x.error&&x.source&&x.safe&&x.factsPassed===x.factsTotal&&x.review?.verdict==="pass").length;
   setComparisonMessage(`对比完成：${total} 组测试，${passed} 组通过基础检查与独立评审。`);
  }catch(e){setComparisonMessage(e instanceof Error?e.message:"对比实验启动失败。");}
  finally{setComparisonRunning(false);}
 }
 async function rerunReview(item:Result) {
  if(reviewingId||!item.answer)return;
  setReviewingId(item.test.id);
  try {
   const supabase=createClient();
   const review=await invokeIndependentReview(supabase,{
    question:item.test.turns?item.test.turns.map((q,i)=>`第${i+1}轮：${q}`).join("\n"):item.test.question,answer:item.answer,expectedFacts:item.test.expected_facts,
    sources:item.sources.map(s=>({title:s.title,content:s.content}))
   });
   setResults(current=>current.map(r=>r.test.id===item.test.id?{...r,review,reviewError:undefined}:r));
  } catch(e) {
   setResults(current=>current.map(r=>r.test.id===item.test.id?{...r,reviewError:e instanceof Error?e.message:"独立评审失败，请稍后重试。"}:r));
  } finally {setReviewingId(null);}
 }
 const tests=dataset.cases;
 const passed=results.filter(allPass).length;
 const needsReview=results.filter(r=>!allPass(r)).length;
 const avg=results.filter(r=>r.review).map(r=>(r.review!.accuracy+r.review!.completeness+r.review!.faithfulness+r.review!.uncertainty)/4);
 const average=avg.length?(avg.reduce((a,b)=>a+b,0)/avg.length).toFixed(2):"—";
 return <main className="mx-auto max-w-5xl space-y-6 p-6">
  <header><p className="text-sm font-medium text-indigo-600">RAG 自动化评估</p><h1 className="mt-1 text-2xl font-bold">云购商城知识库测试</h1>
   <p className="mt-2 text-sm leading-6 text-slate-600">自动执行向量检索、DeepSeek 回答和规则检查。低成本模式下，基础检查通过的题目跳过独立评审；未通过的题目仍会调用评审模型。关闭低成本模式可对全部题目执行完整评审。</p></header>
  <section className="rounded-xl border border-slate-200 bg-white p-4">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><b>测试集：{tests.length} 道题</b><p className="mt-1 text-xs text-slate-500">检索 · 来源 · 事实覆盖 · 按需 DeepSeek 独立评审</p><label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={lowCostMode} onChange={e=>setLowCostMode(e.target.checked)} disabled={running||comparisonRunning}/>低成本模式：基础检查通过的题目跳过独立评审</label></div><div className="flex flex-wrap gap-2">
    <button onClick={()=>run(false)} disabled={running||comparisonRunning} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{running?"正在自动测试…":"开始运行全部测试"}</button>
    <button onClick={()=>run(true)} disabled={running||comparisonRunning} className="rounded-lg border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-700 disabled:opacity-50">仅复测 RAG-013</button>
    <button onClick={runTopKComparison} disabled={running||comparisonRunning} className="rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50">{comparisonRunning?"正在比较…":"运行 Top-K 对比实验"}</button></div></div>
   {(running||results.length>0)&&<div className="mt-4"><div className="mb-1 flex justify-between text-xs text-slate-500"><span>{message}</span><span>{progress}/{runTotal}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-indigo-600" style={{width:`${progress/runTotal*100}%`}}/></div></div>}
   {!running&&message&&<p className="mt-3 text-sm text-slate-700">{message}</p>}
  </section>
  {(comparisonRunning||comparisonResults.length>0)&&<section className="rounded-xl border border-indigo-200 bg-white p-4">
   <div className="flex flex-wrap items-center justify-between gap-2"><b>Top-K 对比实验（Top-3 / Top-5 / Top-10）</b><span className="text-xs text-slate-500">{comparisonProgress}/${tests.length*3}</span></div>
   <p className="mt-1 text-xs text-slate-500">每道题分别检索、生成回答并进行独立评审。耗时包含向量生成、检索、回答和评审，仅用于本次环境下的相对比较。</p>
   {comparisonRunning&&<div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-indigo-600" style={{width:`${comparisonProgress/(tests.length*3)*100}%`}}/></div>}
   {comparisonMessage&&<p className="mt-2 text-sm text-slate-700">{comparisonMessage}</p>}
   {comparisonResults.length>0&&<div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b text-slate-500"><th className="p-2">K值</th><th className="p-2">通过数</th><th className="p-2">评审均分</th><th className="p-2">平均耗时</th><th className="p-2">来源匹配</th></tr></thead><tbody>{[3,5,10].map(k=>{const rows=comparisonResults.filter(x=>x.k===k);const passedRows=rows.filter(x=>!x.error&&x.source&&x.safe&&x.factsPassed===x.factsTotal&&x.review?.verdict==="pass");const reviews=rows.filter(x=>x.review);const score=reviews.length?reviews.reduce((a,x)=>a+(x.review!.accuracy+x.review!.completeness+x.review!.faithfulness+x.review!.uncertainty)/4,0)/reviews.length:0;const avgMs=rows.length?rows.reduce((a,x)=>a+x.elapsedMs,0)/rows.length:0;return <tr key={k} className="border-b"><td className="p-2 font-semibold">Top-{k}</td><td className="p-2">{passedRows.length}/{rows.length||tests.length}</td><td className="p-2">{reviews.length?score.toFixed(2)+"/5":"—"}</td><td className="p-2">{rows.length?Math.round(avgMs/1000)+"秒":"—"}</td><td className="p-2">{rows.length?rows.filter(x=>x.source).length+"/"+rows.length:"—"}</td></tr>})}</tbody></table></div>}
   <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-slate-500">查看每道题的对比明细</summary><div className="mt-2 space-y-2">{comparisonResults.map(x=><div key={x.k+"-"+x.testId} className="rounded-lg border p-2 text-xs"><b>Top-{x.k} · {x.testId}</b><span className="ml-2 text-slate-500">{Math.round(x.elapsedMs/1000)}秒</span>{x.error?<p className="mt-1 text-red-600">{x.error}</p>:<><p className="mt-1">实际检索 {x.retrievalCount} 段（跨轮去重后 {x.uniqueSourceCount} 段） · 来源 {x.source?"匹配":"不匹配"} · 事实 {x.factsPassed}/{x.factsTotal} · 评审 {x.review?.verdict==="pass"?"通过":x.review?.verdict==="review"?"复核":"无"}</p><div className="mt-3 space-y-2 border-t pt-2"><b>DeepSeek 回答</b><p className="whitespace-pre-wrap leading-5">{x.answer||"无回答"}</p><b>关键事实检查</b>{x.facts.map((f,i)=><p key={i} className={f.passed?"text-green-700":"text-red-600"}>{f.passed?"✓":"✗"} {f.fact}</p>)}{x.review&&<><b>独立评审详情</b><p>准确性 {x.review.accuracy}/5 · 完整性 {x.review.completeness}/5 · 证据忠实度 {x.review.faithfulness}/5 · 未知边界 {x.review.uncertainty}/5</p><p>评审意见：{x.review.rationale}</p>{x.review.missingFacts.length>0&&<p>遗漏事实：{x.review.missingFacts.join("；")}</p>}{x.review.unsupportedClaims.length>0&&<p>无依据陈述：{x.review.unsupportedClaims.join("；")}</p>}</>}{x.sources.length>0&&<details className="mt-2"><summary className="cursor-pointer font-medium">查看实际检索片段（{x.sources.length}）</summary>{x.sources.map(s=><div key={s.chunk_id} className="mt-2 rounded border p-2"><p className="font-medium">{s.title} · 第{s.chunk_index+1}段 · 相似度 {(s.similarity*100).toFixed(1)}%</p><p className="mt-1 whitespace-pre-wrap">{s.content}</p></div>)}</details>}</div></>}</div>)}</div></details>
  </section>}
  {results.length>0&&<><div className="grid grid-cols-4 gap-3">{[{l:"已完成",v:results.length},{l:"需复核",v:needsReview},{l:"全部通过",v:passed},{l:"评审平均分",v:average+"/5"}].map(x=><div key={x.l} className="rounded-xl border p-3"><p className="text-xs text-slate-500">{x.l}</p><p className="mt-1 text-2xl font-bold">{x.v}</p></div>)}</div>
   <div className="space-y-4">{results.map(r=><article key={r.test.id} className="rounded-xl border bg-white p-4">
    <div className="flex justify-between gap-2"><b>{r.test.id} · {r.test.category}</b><span className={allPass(r)?"text-sm font-semibold text-green-700":"text-sm font-semibold text-amber-700"}>{r.error?"执行失败":allPass(r)?"全部通过":"需要复核"}</span></div>
    <p className="mt-2 text-sm font-medium">{r.test.question}</p>
    {r.error?<p className="mt-2 text-sm text-red-600">{r.error}</p>:<>
     <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded bg-slate-100 px-2 py-1">检索：{r.retrieval?"有结果":"无结果"}</span><span className="rounded bg-slate-100 px-2 py-1">来源：{r.source?"匹配":"不匹配"}</span><span className="rounded bg-slate-100 px-2 py-1">禁答：{r.safe?"未命中":"命中"}</span></div>
     <div className="mt-3 rounded-lg border border-slate-100 p-3"><b className="text-xs text-slate-500">关键事实覆盖检查</b>{r.facts.map((f,i)=><p key={i} className={f.passed?"mt-2 text-xs text-green-700":"mt-2 text-xs text-red-600"}>{f.passed?"✓":"✗"} {f.fact}</p>)}</div>
     <div className="mt-3 rounded-lg bg-slate-50 p-3"><b className="text-xs text-slate-500">DeepSeek 客服回答</b><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{r.answer}</p></div>
     {r.reviewSkipped&&<div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-600">低成本模式：基础检查已通过，已跳过独立模型评审。若要进行完整质量审查，请关闭低成本模式后重新运行。</p></div>}
     {r.review&&<div className="mt-3 rounded-lg border p-3"><div className="flex items-center justify-between"><b className="text-sm">独立模型评审</b><span className={r.review.verdict==="pass"?"text-sm font-semibold text-green-700":"text-sm font-semibold text-amber-700"}>{r.review.verdict==="pass"?"评审通过":"建议复核"}</span></div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[{l:"准确性",v:r.review.accuracy},{l:"完整性",v:r.review.completeness},{l:"证据忠实度",v:r.review.faithfulness},{l:"未知边界",v:r.review.uncertainty}].map(s=><div key={s.l} className="rounded bg-slate-50 p-2"><p className="text-xs text-slate-500">{s.l}</p><p className="mt-1 text-lg font-semibold">{s.v}/5</p></div>)}</div>
      <p className="mt-3 text-sm leading-6">{r.review.rationale}</p>
      {r.review.unsupportedClaims.length>0&&<div className="mt-3"><b className="text-xs text-red-600">发现无依据陈述</b>{r.review.unsupportedClaims.map((x,i)=><p key={i} className="mt-1 text-xs text-red-700">• {x}</p>)}</div>}
      {r.review.missingFacts.length>0&&<div className="mt-3"><b className="text-xs text-amber-700">可能遗漏的事实</b>{r.review.missingFacts.map((x,i)=><p key={i} className="mt-1 text-xs text-amber-700">• {x}</p>)}</div>}
     </div>}
     {r.reviewError&&<div className="mt-3 rounded-lg bg-red-50 p-3"><p className="text-sm text-red-700">独立评审失败：{r.reviewError}</p><button onClick={()=>rerunReview(r)} disabled={!!reviewingId||running} className="mt-2 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">{reviewingId===r.test.id?"正在重新评审…":"仅重新评审这道题"}</button></div>}
     <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-slate-500">查看实际检索来源（{r.sources.length}）</summary><div className="mt-2 space-y-2">{r.sources.map(s=><div key={s.chunk_id} className="rounded-lg border p-3"><p className="text-xs font-medium">{s.title} · 第 {s.chunk_index+1} 段 · 相似度 {(s.similarity*100).toFixed(1)}%</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-500">{s.content}</p></div>)}</div></details>
    </>}
   </article>)}</div></>}
 </main>;
}