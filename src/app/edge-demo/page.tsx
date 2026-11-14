"use client";

import { useEffect, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/client";

type FunctionResponse = {
  message?: string;
  question?: string;
  answer?: string;
  model?: string;
  error?: string;
};

type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type ChatMessage = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type ChatMessageVersion = {
  id: string;
  message_id: string;
  user_id: string;
  version_number: number;
  content: string;
  created_at: string;
};

type KnowledgeDocument = {
  id: string;
  title: string;
  file_type: "txt" | "md";
  content_length: number;
  chunk_count: number;
  created_at: string;
};

type RetrievedKnowledgeChunk = {
  chunk_id: string;
  document_id: string;
  title: string;
  chunk_index: number;
  content: string;
  similarity: number;
};

type ChatMessageSource = {
  message_id: string;
  user_id: string;
  document_id: string | null;
  title: string;
  chunk_index: number;
  content: string;
  similarity: number;
  source_order: number;
};

type LegacyQuestion = {
  id: string;
  question: string;
  answer: string | null;
  created_at: string;
};

function splitIntoChunks(text: string, maxLength = 1200, overlap = 150) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxLength, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf("\n", end);
      if (boundary > start + Math.floor(maxLength * 0.6)) end = boundary;
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

// 某些模型会把 Markdown 标点额外加上反斜杠；渲染前恢复常见 Markdown 标记。
function normalizeMarkdown(markdown: string) {
  return markdown.replace(/\\([\\`*_{}\[\]()#+.!|>~-])/g, "$1");
}

function withTimeout<T>(promise: PromiseLike<T>, label: string, ms = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时（12 秒）。请检查网络或重新登录后重试。`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="mt-2 space-y-3 break-words text-sm leading-7 text-slate-800 [&_a]:text-indigo-700 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-4 [&_blockquote]:text-slate-600 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:p-4 [&_pre]:text-slate-50 [&_strong]:font-bold [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-3 [&_th]:py-2 [&_ul]:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {normalizeMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

export default function EdgeDemoPage() {
  const [userId, setUserId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [legacyHistory, setLegacyHistory] = useState<LegacyQuestion[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageLoadStage, setPageLoadStage] = useState("页面已加载，准备验证登录…");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [legacyExpandedId, setLegacyExpandedId] = useState<string | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const [searchingConversations, setSearchingConversations] = useState(false);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [messageVersions, setMessageVersions] = useState<Record<string, ChatMessageVersion[]>>({});
  const [displayedVersionIndexes, setDisplayedVersionIndexes] = useState<Record<string, number>>({});
  const [messageSources, setMessageSources] = useState<Record<string, ChatMessageSource[]>>({});
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [uploadingKnowledge, setUploadingKnowledge] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPage() {
      try {
        setPageLoadStage("正在验证登录状态…");
        const supabase = createClient();
        const authResponse = await withTimeout(
          fetch("/api/current-user", { cache: "no-store", credentials: "same-origin" }),
          "验证登录状态",
        );
        const authResult = await authResponse.json();

        if (!authResponse.ok || !authResult.userId) {
          throw new Error(authResult.error || "当前没有有效的登录会话，请先登录。");
        }
        if (!active) return;
        const currentUserId = authResult.userId as string;
        setUserId(currentUserId);

        const { data: knowledgeRows, error: knowledgeError } = await supabase
          .from("knowledge_documents")
          .select("id, title, file_type, content_length, chunk_count, created_at")
          .eq("user_id", currentUserId)
          .order("created_at", { ascending: false });
        if (knowledgeError) throw knowledgeError;
        if (active) setKnowledgeDocuments((knowledgeRows ?? []) as KnowledgeDocument[]);

        setPageLoadStage("正在读取对话列表和旧版记录…");
        const [{ data: conversationRows, error: conversationError }, { data: oldRows, error: oldError }] =
          await withTimeout(
            Promise.all([
              supabase
                .from("conversations")
                .select("id, title, created_at, updated_at")
                .eq("user_id", currentUserId)
                .order("updated_at", { ascending: false })
                .limit(30),
              supabase
                .from("questions")
                .select("id, question, answer, created_at")
                .eq("user_id", currentUserId)
                .order("created_at", { ascending: false })
                .limit(20),
            ]),
            "读取数据库记录",
          );

        if (conversationError) throw conversationError;
        if (oldError) throw oldError;
        if (!active) return;

        const loadedConversations = (conversationRows ?? []) as Conversation[];
        setConversations(loadedConversations);
        setLegacyHistory((oldRows ?? []) as LegacyQuestion[]);

        if (loadedConversations.length > 0) {
          const firstId = loadedConversations[0].id;
          setActiveConversationId(firstId);
          setPageLoadStage("正在读取最近一段对话…");
          const { data: messageRows, error: messageError } = await withTimeout(
            supabase
              .from("chat_messages")
              .select("id, conversation_id, user_id, role, content, created_at")
              .eq("conversation_id", firstId)
              .eq("user_id", currentUserId)
              .order("created_at", { ascending: true }),
            "读取聊天消息",
          );

          if (messageError) throw messageError;
          if (active) {
            const loadedMessages = (messageRows ?? []) as ChatMessage[];
            setMessages(loadedMessages);
            const assistantIds = loadedMessages.filter((item) => item.role === "assistant").map((item) => item.id);
            if (assistantIds.length > 0) {
              const { data: sourceRows, error: sourceError } = await supabase
                .from("chat_message_sources")
                .select("message_id, user_id, document_id, title, chunk_index, content, similarity, source_order")
                .in("message_id", assistantIds)
                .eq("user_id", currentUserId)
                .order("source_order", { ascending: true });
              if (sourceError) throw sourceError;
              const groupedSources = (sourceRows ?? []).reduce<Record<string, ChatMessageSource[]>>((acc, source) => {
                (acc[source.message_id] ??= []).push(source as ChatMessageSource);
                return acc;
              }, {});
              if (active) setMessageSources(groupedSources);

              const { data: versionRows, error: versionError } = await supabase
                .from("chat_message_versions")
                .select("id, message_id, user_id, version_number, content, created_at")
                .in("message_id", assistantIds)
                .eq("user_id", currentUserId)
                .order("version_number", { ascending: true });
              if (versionError) throw versionError;
              const grouped = (versionRows ?? []).reduce<Record<string, ChatMessageVersion[]>>((acc, version) => {
                (acc[version.message_id] ??= []).push(version as ChatMessageVersion);
                return acc;
              }, {});
              if (active) setMessageVersions(grouped);
            }
          }
        }
      } catch (error) {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : "页面加载失败，请刷新后重试。");
        }
      } finally {
        if (active) setPageLoading(false);
      }
    }

    loadPage();
    return () => {
      active = false;
    };
  }, []);

  async function openConversation(conversationId: string) {
    if (conversationId === activeConversationId) return;
    setMessagesLoading(true);
    setErrorMessage("");
    setActiveConversationId(conversationId);
    setMessages([]);
    setMessageVersions({});
    setDisplayedVersionIndexes({});
    setMessageSources({});

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, conversation_id, user_id, role, content, created_at")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      const loadedMessages = (data ?? []) as ChatMessage[];
      setMessages(loadedMessages);
      const assistantIds = loadedMessages.filter((item) => item.role === "assistant").map((item) => item.id);
      if (assistantIds.length > 0) {
        const { data: sourceRows, error: sourceError } = await supabase
          .from("chat_message_sources")
          .select("message_id, user_id, document_id, title, chunk_index, content, similarity, source_order")
          .in("message_id", assistantIds)
          .eq("user_id", userId)
          .order("source_order", { ascending: true });
        if (sourceError) throw sourceError;
        const groupedSources = (sourceRows ?? []).reduce<Record<string, ChatMessageSource[]>>((acc, source) => {
          (acc[source.message_id] ??= []).push(source as ChatMessageSource);
          return acc;
        }, {});
        setMessageSources(groupedSources);

        const { data: versionRows, error: versionError } = await supabase
          .from("chat_message_versions")
          .select("id, message_id, user_id, version_number, content, created_at")
          .in("message_id", assistantIds)
          .eq("user_id", userId)
          .order("version_number", { ascending: true });
        if (versionError) throw versionError;
        const grouped = (versionRows ?? []).reduce<Record<string, ChatMessageVersion[]>>((acc, version) => {
          (acc[version.message_id] ??= []).push(version as ChatMessageVersion);
          return acc;
        }, {});
        setMessageVersions(grouped);
      } else {
        setMessageVersions({});
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法读取这段对话。");
    } finally {
      setMessagesLoading(false);
    }
  }

  function startNewConversation() {
    setEditingConversationId(null);
    setEditingTitle("");
    setActiveConversationId(null);
    setMessages([]);
    setMessageVersions({});
    setDisplayedVersionIndexes({});
    setMessageSources({});
    setQuestion("");
    setErrorMessage("");
  }

  async function retrieveKnowledge(searchText: string): Promise<RetrievedKnowledgeChunk[] | null> {
    if (knowledgeDocuments.length === 0) return null;
    const supabase = createClient();

    // 先将用户问题转换为与知识库相同模型、相同维度的向量。
    const { data: embeddingData, error: embeddingError } = await supabase.functions.invoke<{
      embeddings?: number[][];
      error?: string;
    }>("embed-knowledge-chunks", {
      body: { inputs: [searchText] },
    });
    if (embeddingError) throw new Error(`问题向量生成失败：${embeddingError.message}`);
    if (embeddingData?.error) throw new Error(embeddingData.error);

    const queryEmbedding = embeddingData?.embeddings?.[0];
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 1024) {
      throw new Error("问题向量生成失败：返回的向量维度不是 1024。");
    }

    // 将问题向量交给 Supabase，按余弦相似度检索当前用户自己的资料。
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: queryEmbedding,
      match_count: 5,
    });
    if (error) throw new Error(`知识库向量检索失败：${error.message}`);
    return (data ?? []) as RetrievedKnowledgeChunk[];
  }

  async function uploadKnowledgeFile(file: File) {
    if (!userId || uploadingKnowledge) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "txt" && extension !== "md") {
      setKnowledgeMessage("目前只支持 .txt 和 .md 文件。");
      return;
    }
    if (file.size > 500_000) {
      setKnowledgeMessage("文件不能超过 500 KB。");
      return;
    }

    setUploadingKnowledge(true);
    setKnowledgeMessage("");
    let createdDocumentId: string | null = null;
    try {
      const content = await file.text();
      if (!content.trim()) throw new Error("文件内容为空。");
      if (content.length > 500_000) throw new Error("文件文本不能超过 50 万字符。");
      const chunks = splitIntoChunks(content);
      if (chunks.length === 0) throw new Error("没有提取到可用文本。");

      const supabase = createClient();
      const { data: document, error: documentError } = await supabase
        .from("knowledge_documents")
        .insert({
          user_id: userId,
          title: file.name.slice(0, 240),
          file_type: extension,
          content_length: content.length,
          chunk_count: chunks.length,
        })
        .select("id, title, file_type, content_length, chunk_count, created_at")
        .single();
      if (documentError) throw new Error(`保存资料信息失败：${documentError.message}`);
      createdDocumentId = document.id;

      const embeddings: number[][] = [];
      for (let offset = 0; offset < chunks.length; offset += 16) {
        const batch = chunks.slice(offset, offset + 16);
        const { data: embeddingData, error: embeddingError } = await supabase.functions.invoke<{
          embeddings?: number[][];
          error?: string;
        }>("embed-knowledge-chunks", {
          body: { inputs: batch },
        });
        if (embeddingError) throw new Error(`生成文本向量失败：${embeddingError.message}`);
        if (embeddingData?.error) throw new Error(embeddingData.error);
        if (!Array.isArray(embeddingData?.embeddings) ||
            embeddingData.embeddings.length !== batch.length ||
            embeddingData.embeddings.some((vector) => !Array.isArray(vector) || vector.length !== 1024)) {
          throw new Error("Embedding 服务返回的向量数量或维度不正确。");
        }
        embeddings.push(...embeddingData.embeddings);
        setKnowledgeMessage(`正在生成向量：${Math.min(offset + batch.length, chunks.length)} / ${chunks.length}`);
      }

      const rows = chunks.map((chunk, index) => ({
        document_id: document.id,
        user_id: userId,
        chunk_index: index,
        content: chunk,
        embedding: embeddings[index],
      }));
      const { error: chunksError } = await supabase.from("knowledge_chunks").insert(rows);
      if (chunksError) throw new Error(`保存资料片段失败：${chunksError.message}`);

      createdDocumentId = null;
      setKnowledgeDocuments((current) => [document as KnowledgeDocument, ...current]);
      setKnowledgeMessage(`上传成功：已将“${file.name}”拆分为 ${chunks.length} 个片段，并生成 1024 维向量。`);
    } catch (error) {
      if (createdDocumentId) {
        const supabase = createClient();
        await supabase.from("knowledge_documents").delete().eq("id", createdDocumentId).eq("user_id", userId);
      }
      setKnowledgeMessage(error instanceof Error ? error.message : "上传失败，请重试。");
    } finally {
      setUploadingKnowledge(false);
    }
  }

  async function deleteKnowledgeDocument(document: KnowledgeDocument) {
    if (!window.confirm(`确定删除知识库资料“${document.title}”吗？其文本片段也会一并删除。`)) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("knowledge_documents")
      .delete()
      .eq("id", document.id)
      .eq("user_id", userId);
    if (error) {
      setKnowledgeMessage(`删除失败：${error.message}`);
      return;
    }
    setKnowledgeDocuments((current) => current.filter((item) => item.id !== document.id));
    setKnowledgeMessage(`已删除“${document.title}”。`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || loading) return;

    if (!userId) {
      setErrorMessage("登录状态无效，请重新登录后再试。");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      const supabase = createClient();
      let conversationId = activeConversationId;
      let currentConversation = conversations.find((item) => item.id === conversationId);

      if (!conversationId) {
        const title = trimmedQuestion.length > 36
          ? `${trimmedQuestion.slice(0, 36)}…`
          : trimmedQuestion;
        const { data: created, error: createError } = await supabase
          .from("conversations")
          .insert({ user_id: userId, title })
          .select("id, title, created_at, updated_at")
          .single();

        if (createError) throw new Error(`创建对话失败：${createError.message}`);
        currentConversation = created as Conversation;
        conversationId = currentConversation.id;
        setActiveConversationId(conversationId);
        setConversations((current) => [currentConversation!, ...current]);
      }

      const context = messages.slice(-20).map((item) => ({
        role: item.role,
        content: item.content,
      }));

      const knowledgeContext = await retrieveKnowledge(trimmedQuestion);
      const { data, error } = await supabase.functions.invoke<FunctionResponse>(
        "hello-world",
        {
          body: {
            question: trimmedQuestion,
            history: context,
            knowledgeContext: knowledgeContext === null
              ? null
              : knowledgeContext.map((item) => ({
                  title: item.title,
                  chunkIndex: item.chunk_index,
                  content: item.content,
                })),
          },
        },
      );

      if (error) throw new Error(`AI 云函数调用失败：${error.message}`);
      if (data?.error) throw new Error(data.error);
      if (!data?.answer) throw new Error("AI 没有返回有效回答，请稍后重试。");

      const { data: savedMessages, error: saveError } = await supabase
        .from("chat_messages")
        .insert([
          {
            conversation_id: conversationId,
            user_id: userId,
            role: "user",
            content: trimmedQuestion,
          },
          {
            conversation_id: conversationId,
            user_id: userId,
            role: "assistant",
            content: data.answer,
          },
        ])
        .select("id, conversation_id, user_id, role, content, created_at");

      if (saveError) {
        throw new Error(`AI 已回答，但保存对话失败：${saveError.message}`);
      }

      const insertedMessages = (savedMessages ?? []) as ChatMessage[];
      setMessages((current) => [...current, ...insertedMessages]);
      const assistantMessage = insertedMessages.find((item) => item.role === "assistant");
      if (assistantMessage && knowledgeContext && knowledgeContext.length > 0) {
        const sourceRows = knowledgeContext.map((source, index) => ({
          message_id: assistantMessage.id,
          user_id: userId,
          document_id: source.document_id,
          title: source.title,
          chunk_index: source.chunk_index,
          content: source.content,
          similarity: source.similarity,
          source_order: index + 1,
        }));
        const { error: sourceSaveError } = await supabase
          .from("chat_message_sources")
          .insert(sourceRows);
        if (sourceSaveError) {
          setErrorMessage(`回答已保存，但知识来源保存失败：${sourceSaveError.message}`);
        } else {
          setMessageSources((current) => ({ ...current, [assistantMessage.id]: sourceRows }));
        }
      }
      setQuestion("");

      const updatedAt = new Date().toISOString();
      await supabase
        .from("conversations")
        .update({ updated_at: updatedAt })
        .eq("id", conversationId)
        .eq("user_id", userId);

      setConversations((current) =>
        current
          .map((item) => item.id === conversationId ? { ...item, updated_at: updatedAt } : item)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "请求失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function regenerateAnswer(assistantMessage: ChatMessage) {
    if (!activeConversationId || loading || regeneratingMessageId) return;

    const assistantIndex = messages.findIndex((item) => item.id === assistantMessage.id);
    if (assistantIndex < 0 || assistantMessage.role !== "assistant") {
      setErrorMessage("找不到需要重新生成的 AI 回答。");
      return;
    }

    let questionIndex = assistantIndex - 1;
    while (questionIndex >= 0 && messages[questionIndex].role !== "user") {
      questionIndex -= 1;
    }
    if (questionIndex < 0) {
      setErrorMessage("找不到这条 AI 回答对应的用户问题。");
      return;
    }

    const originalQuestion = messages[questionIndex].content;
    const context = messages.slice(0, questionIndex).slice(-20).map((item) => ({
      role: item.role,
      content: item.content,
    }));

    setRegeneratingMessageId(assistantMessage.id);
    setErrorMessage("");
    try {
      const supabase = createClient();
      const knowledgeContext = await retrieveKnowledge(originalQuestion);
      const { data, error } = await supabase.functions.invoke<FunctionResponse>(
        "hello-world",
        {
          body: {
            question: originalQuestion,
            history: context,
            knowledgeContext: knowledgeContext === null
              ? null
              : knowledgeContext.map((item) => ({
                  title: item.title,
                  chunkIndex: item.chunk_index,
                  content: item.content,
                })),
          },
        },
      );

      if (error) throw new Error(`AI 云函数调用失败：${error.message}`);
      if (data?.error) throw new Error(data.error);
      if (!data?.answer) throw new Error("AI 没有返回有效回答，请稍后重试。");

      const { data: archivedRows, error: archivedError } = await supabase
        .from("chat_message_versions")
        .select("id, message_id, user_id, version_number, content, created_at")
        .eq("message_id", assistantMessage.id)
        .eq("user_id", userId)
        .order("version_number", { ascending: true });

      if (archivedError) throw new Error(`读取历史回答版本失败：${archivedError.message}`);

      const archivedVersions = (archivedRows ?? []) as ChatMessageVersion[];
      const latestArchived = archivedVersions[archivedVersions.length - 1];

      // 先保存当前回答；若上次保存版本后更新失败，则复用已有记录，避免重复归档。
      let nextArchivedVersions = archivedVersions;
      if (!latestArchived || latestArchived.content !== assistantMessage.content) {
        const nextVersionNumber = (latestArchived?.version_number ?? 0) + 1;
        const { data: archivedVersion, error: archiveError } = await supabase
          .from("chat_message_versions")
          .insert({
            message_id: assistantMessage.id,
            user_id: userId,
            version_number: nextVersionNumber,
            content: assistantMessage.content,
          })
          .select("id, message_id, user_id, version_number, content, created_at")
          .single();

        if (archiveError) throw new Error(`保存旧回答版本失败：${archiveError.message}`);
        nextArchivedVersions = [...archivedVersions, archivedVersion as ChatMessageVersion];
      }

      const { data: updatedMessage, error: updateError } = await supabase
        .from("chat_messages")
        .update({ content: data.answer })
        .eq("id", assistantMessage.id)
        .eq("conversation_id", activeConversationId)
        .eq("user_id", userId)
        .select("id, conversation_id, user_id, role, content, created_at")
        .single();

      if (updateError) throw new Error(`保存新回答失败：${updateError.message}`);

      setMessageVersions((current) => ({
        ...current,
        [assistantMessage.id]: nextArchivedVersions,
      }));
      setDisplayedVersionIndexes((current) => ({
        ...current,
        [assistantMessage.id]: nextArchivedVersions.length,
      }));
      setMessages((current) =>
        current.map((item) => item.id === assistantMessage.id ? updatedMessage as ChatMessage : item),
      );

      const { error: deleteSourcesError } = await supabase
        .from("chat_message_sources")
        .delete()
        .eq("message_id", assistantMessage.id)
        .eq("user_id", userId);
      if (deleteSourcesError) throw new Error(`新回答已保存，但清理旧知识来源失败：${deleteSourcesError.message}`);

      if (knowledgeContext && knowledgeContext.length > 0) {
        const sourceRows = knowledgeContext.map((source, index) => ({
          message_id: assistantMessage.id,
          user_id: userId,
          document_id: source.document_id,
          title: source.title,
          chunk_index: source.chunk_index,
          content: source.content,
          similarity: source.similarity,
          source_order: index + 1,
        }));
        const { error: sourceSaveError } = await supabase
          .from("chat_message_sources")
          .insert(sourceRows);
        if (sourceSaveError) throw new Error(`新回答已保存，但知识来源保存失败：${sourceSaveError.message}`);
        setMessageSources((current) => ({ ...current, [assistantMessage.id]: sourceRows }));
      } else {
        setMessageSources((current) => {
          const next = { ...current };
          delete next[assistantMessage.id];
          return next;
        });
      }

      const updatedAt = new Date().toISOString();
      await supabase
        .from("conversations")
        .update({ updated_at: updatedAt })
        .eq("id", activeConversationId)
        .eq("user_id", userId);

      setConversations((current) =>
        current
          .map((item) => item.id === activeConversationId ? { ...item, updated_at: updatedAt } : item)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重新生成回答失败，请稍后重试。");
    } finally {
      setRegeneratingMessageId(null);
    }
  }

  function getDisplayedAnswer(message: ChatMessage) {
    const versions = messageVersions[message.id] ?? [];
    const selectedIndex = displayedVersionIndexes[message.id] ?? versions.length;
    return selectedIndex < versions.length ? versions[selectedIndex].content : message.content;
  }

  function changeDisplayedVersion(messageId: string, nextIndex: number) {
    setDisplayedVersionIndexes((current) => ({
      ...current,
      [messageId]: nextIndex,
    }));
  }

  async function searchConversations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = conversationSearch.trim();
    if (!term) {
      setSearchResults(null);
      setErrorMessage("");
      return;
    }
    if (!userId) return;

    setSearchingConversations(true);
    setErrorMessage("");
    try {
      const supabase = createClient();
      const [titleResult, messageResult] = await Promise.all([
        supabase
          .from("conversations")
          .select("id, title, created_at, updated_at")
          .eq("user_id", userId)
          .ilike("title", `%${term}%`)
          .limit(100),
        supabase
          .from("chat_messages")
          .select("conversation_id")
          .eq("user_id", userId)
          .ilike("content", `%${term}%`)
          .limit(500),
      ]);

      if (titleResult.error) throw titleResult.error;
      if (messageResult.error) throw messageResult.error;

      const matchedIds = new Set<string>();
      for (const item of titleResult.data ?? []) matchedIds.add(item.id);
      for (const item of messageResult.data ?? []) matchedIds.add(item.conversation_id);

      if (matchedIds.size === 0) {
        setSearchResults([]);
      } else {
        const { data: matchedConversations, error: matchedError } = await supabase
          .from("conversations")
          .select("id, title, created_at, updated_at")
          .eq("user_id", userId)
          .in("id", [...matchedIds])
          .order("updated_at", { ascending: false });
        if (matchedError) throw matchedError;
        setSearchResults((matchedConversations ?? []) as Conversation[]);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "搜索历史对话失败。");
    } finally {
      setSearchingConversations(false);
    }
  }

  function clearConversationSearch() {
    setConversationSearch("");
    setSearchResults(null);
  }

  function beginRenameConversation(conversation: Conversation) {
    setEditingConversationId(conversation.id);
    setEditingTitle(conversation.title);
    setErrorMessage("");
  }

  async function saveConversationTitle(conversationId: string) {
    const title = editingTitle.trim();
    if (!title) {
      setErrorMessage("对话标题不能为空。");
      return;
    }
    if (title.length > 120) {
      setErrorMessage("对话标题不能超过 120 个字符。");
      return;
    }

    setSavingTitle(true);
    setErrorMessage("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .update({ title })
        .eq("id", conversationId)
        .eq("user_id", userId)
        .select("id, title, created_at, updated_at")
        .single();

      if (error) throw error;
      const updated = data as Conversation;
      setConversations((current) =>
        current.map((item) => item.id === conversationId ? updated : item),
      );
      setEditingConversationId(null);
      setEditingTitle("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "修改对话标题失败。");
    } finally {
      setSavingTitle(false);
    }
  }

  async function deleteConversation(conversationId: string) {
    const confirmed = window.confirm("确定删除这段对话及其全部消息吗？此操作无法撤销。");
    if (!confirmed) return;

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("id", conversationId)
        .eq("user_id", userId);

      if (error) throw error;
      const remaining = conversations.filter((item) => item.id !== conversationId);
      setConversations(remaining);
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除对话失败。");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-5">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-wide text-indigo-600">
          SUPABASE EDGE FUNCTIONS + DEEPSEEK
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              AI 多轮对话助手
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              每段对话独立保存。AI 会结合当前会话最近 20 条消息理解上下文。
            </p>
          </div>
          <button
            type="button"
            onClick={startNewConversation}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            + 新建对话
          </button>
        </div>

        {errorMessage ? (
          <div role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}

        {pageLoading ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
            {pageLoadStage}
          </div>
        ) : (
          <>
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">我的 RAG 知识库</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                上传专属资料后，提问时会先检索相关内容，再交给 DeepSeek 作答。
              </p>
            </div>
            <label className="cursor-pointer rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              {uploadingKnowledge ? "正在上传…" : "+ 上传资料"}
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                className="hidden"
                disabled={uploadingKnowledge}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadKnowledgeFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-400">第一版支持 TXT、Markdown（.md），单个文件最大 500 KB。资料仅当前登录用户可访问。</p>
          {knowledgeMessage ? (
            <p role="status" className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{knowledgeMessage}</p>
          ) : null}
          {knowledgeDocuments.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-500">
              还没有资料。上传一份 TXT 或 Markdown 文件开始建立知识库。
            </p>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {knowledgeDocuments.map((document) => (
                <div key={document.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{document.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{document.chunk_count} 个文本片段 · {document.content_length.toLocaleString()} 字符</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteKnowledgeDocument(document)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-7 grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-semibold text-slate-900">我的对话</h2>
              <form onSubmit={searchConversations} className="mt-3 space-y-2">
                <input
                  value={conversationSearch}
                  onChange={(event) => setConversationSearch(event.target.value)}
                  maxLength={120}
                  placeholder="搜索标题或聊天内容…"
                  aria-label="搜索历史对话"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={searchingConversations || !conversationSearch.trim()}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    {searchingConversations ? "搜索中…" : "搜索"}
                  </button>
                  {searchResults !== null ? (
                    <button
                      type="button"
                      onClick={clearConversationSearch}
                      className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
                    >
                      清除
                    </button>