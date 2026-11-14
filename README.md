# E-commerce AI Customer Support & RAG Evaluation Platform

An AI-powered Chinese-language e-commerce customer support demo built with Next.js, Supabase, BGE-M3 embeddings, and DeepSeek. After signing in, users can upload their own knowledge documents. The application retrieves relevant passages from the knowledge base and uses them as context for generated answers, while preserving source references to help users verify responses.

> **Project scope:** This is a working learning and portfolio project. Live order lookup, shipment tracking, and refund execution are not integrated. The demo must not be represented as a system that can access or operate on real customer orders.

## Live Demo

[Open the deployed application](https://nextjs-auth-app-pearl.vercel.app)

## Features

- **Authentication:** Supabase Auth with Next.js App Router and `@supabase/ssr` session handling.
- **Knowledge-base uploads:** Supports TXT and Markdown files. Documents are split into text chunks and stored with document and chunk metadata.
- **RAG retrieval:** BGE-M3 generates 1,024-dimensional embeddings. Supabase RPC `match_knowledge_chunks` performs similarity search with pgvector.
- **AI customer support:** User questions, conversation history, and retrieved passages are sent to the `hello-world` Supabase Edge Function, which calls DeepSeek to generate an answer.
- **Source attribution:** The interface displays the retrieved passages, document titles, and similarity scores associated with an answer.
- **Conversation management:** Supports conversation history, message records, and answer versions.
- **Automated evaluation:** A 14-question RAG test set checks retrieval, source matching, key-fact coverage, and refusal rules. An independent model review can be used when needed.
- **Retrieval experiments:** A comparison page evaluates Top-3, Top-5, and Top-10 retrieval settings.

## Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | Next.js 16, React 19, TypeScript | Pages, interactions, chat interface, and evaluation UI |
| Authentication | Supabase Auth, `@supabase/ssr` | User authentication and server-side cookie sessions |
| Database and vector search | Supabase Database, PostgreSQL, pgvector, RPC | User data, conversations, knowledge chunks, embeddings, and similarity search |
| Embeddings | BGE-M3 (1,024 dimensions) | Converts knowledge chunks and user queries into vectors |
| Language model | DeepSeek | Generates answers grounded in retrieved context |
| Backend | Supabase Edge Functions | Embedding, answer generation, and independent evaluation logic |
| Evaluation | Rule-based checks and independent DeepSeek review | Checks key facts, sources, refusal boundaries, and answer quality |
| Deployment | Vercel | Production web application hosting |

## RAG Question-Answering Workflow

1. A user signs in and uploads TXT or Markdown knowledge documents.
2. The application cleans and splits the text into overlapping chunks.
3. The embedding service generates a 1,024-dimensional vector for each chunk and stores it.
4. When a user asks a question, the question is converted into a vector.
5. The application calls `match_knowledge_chunks` to retrieve relevant passages. The current production chat uses Top-5 retrieval.
6. The question, conversation history, and retrieved passages are sent to the answer-generation Edge Function.
7. DeepSeek generates a context-grounded response. The answer and its source references are saved for display.

## Application Routes

After starting the local development server:

- `/login` — Sign in
- `/signup` — Create an account
- `/dashboard` — User dashboard
- `/edge-demo` — AI customer support chat, knowledge uploads, and source inspection
- `/embedding-test` — Embedding API connectivity test
- `/rag-evaluation` — 14-question RAG evaluation and Top-K comparison

## Evaluation Design and Recorded Results

The evaluation dataset is stored at `tests/rag-evaluation.json` and contains 14 test cases covering:

- Direct factual questions, semantic rephrasing, and multi-part questions
- Shipping deadlines, delivery estimates, and refund rules
- Multi-turn conversation context
- Knowledge boundaries, including live logistics and real order status
- False premises and promises the assistant should not make

Basic checks examine whether relevant content was retrieved, whether the source matches, whether a refusal rule was triggered, and whether key facts are covered. Independent model review additionally examines accuracy, completeness, evidence faithfulness, handling of unknowns, and unsupported claims.

### Top-K Comparison

The evaluation page can run the same test set with Top-3, Top-5, and Top-10 retrieval settings and compare pass counts, source matching, review scores, and latency. Results depend on the knowledge-base contents and model responses, so the comparison is intended to be rerun rather than treated as a permanent benchmark. The production chat currently uses **Top-5** retrieval.

### Cost-Saving Evaluation Mode

The evaluation page enables cost-saving mode by default. Test cases that pass all basic checks skip the independent review call; cases that fail a basic check are still sent for review. Disable this mode to run independent review for every case. A skipped review must not be interpreted as a new model score.

In the latest single-case retest, **RAG-013 passed all basic checks**: retrieval returned results, the source matched, no refusal rule was triggered, and both key facts were covered. The case had previously received 5.00/5 in a full independent review.

## Run Locally

### Requirements

- Node.js (a currently supported LTS release is recommended)
- npm
- A Supabase project configured with the required database tables, authentication, vector search function, and Edge Functions
- Configured Embedding and DeepSeek API services

### Install Dependencies

```bash
npm install
```

### Configure Environment Variables

Create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Never place a server-side Secret Key, Service Role Key, or third-party model API key in a `NEXT_PUBLIC_*` variable. Do not commit real credentials to Git.

Embedding and DeepSeek server-side credentials should be configured as Supabase Edge Function secrets, not exposed in the browser.

### Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> Configuring the frontend environment variables alone is not sufficient to deploy the complete system from scratch. The Supabase tables, RLS policies, vector extension, RPC, and Edge Functions must also be configured.

## Supabase Edge Functions and RPC

The frontend currently calls these Edge Functions:

- `embedding-test` — Single-text embedding connectivity test
- `embed-knowledge-chunks` — Generates embeddings for knowledge chunks in batches
- `hello-world` — Generates customer support answers
- `evaluate-rag-answer` — Performs independent model review

Vector search RPC:

- `match_knowledge_chunks` — Retrieves knowledge chunks by query vector and supports a configurable result count.

## Limitations and Future Improvements

The system answers questions using documents uploaded by the user. It does not directly access real e-commerce orders, shipment tracking events, or payment status, and it cannot request shipment dispatch or execute refunds. When the knowledge base does not cover a policy, the assistant should state that the information is unavailable and direct the user to human support.

Potential next steps:

1. Add an architecture diagram and a short demo video.
2. Improve deployment scripts, database schema documentation, and the RLS security checklist.
3. Expand scenario coverage and manually review model outputs.

## Disclaimer

This project is intended for learning, demonstration, and portfolio purposes. Evaluation results combine automated rules and model judgments; they are not a comprehensive production-quality or security certification. Before commercial use, the application requires further validation of permissions, security, privacy, reliability, cost, and human-support workflows.