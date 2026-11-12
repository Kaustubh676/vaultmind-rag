# Verity Vault

Verity Vault is a full-stack AI Knowledge Base and Team Workspace built with React, Node.js/Express, WebSockets, and PostgreSQL (`pgvector`). Teams can organize PDFs into shared collections, run real-time Retrieval-Augmented Generation (RAG) queries with clickable page-level source citations, and monitor workspace activity through an Admin observability console.

## Key Features

- **Authentication & Role-Based Access Control (RBAC)**
  - Supports **Email/Password** authentication (scrypt password hashing + signed HS256 JWT sessions via `jose`) and **Google OAuth** (Firebase Authentication ID token verification).
  - Automatic first-user promotion: the first registered user receives the `admin` role, subsequent sign-ups default to `member`, and Admins can manage member roles from the **Team & Roles** console.
- **PDF Ingestion & `pgvector` RAG Pipeline**
  - Extracts page-level text from uploaded PDFs using `unpdf`, with an automatic multimodal Gemini PDF extraction fallback for scanned or image-based documents.
  - Splits text into overlapping chunks with page provenance, generates 768-dimensional embeddings via `gemini-embedding-2`, and stores vectors in PostgreSQL with an HNSW cosine index (`vector_cosine_ops`).
  - Answers user questions using `gemini-4-hydrogen` grounded strictly in retrieved chunks, rendering clickable inline citations (`[1]`, `[2]`) linked to a **Source Citation Inspector** showing document title, page number, relevance score, and verbatim excerpt.
- **Real-Time WebSockets & Strict REST APIs**
  - Request payloads and WebSocket messages are validated with `zod`.
  - Streams RAG responses token-by-token over WebSockets (`/ws`) and broadcasts live team notifications for newly indexed documents, created collections, and role updates.
- **Admin Observability & Audit Logging**
  - Records API/WebSocket request latencies into PostgreSQL and displays 24-hour KPIs (total queries, indexed chunks, mean and P95 latency, active sockets) alongside an endpoint latency breakdown.
  - Maintains a filterable and searchable audit trail for authentication events, document uploads/deletions, collection creation, RAG queries, and role updates.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons
- **Backend**: Node.js, Express, `ws` (WebSockets), Multer, Zod, `jose`
- **Database & ORM**: PostgreSQL + `pgvector`, Drizzle ORM, Drizzle Kit, `pg`
- **AI & PDF Processing**: `@google/genai` (`gemini-4-hydrogen`, `gemini-embedding-2`), `unpdf`
- **Auth**: Firebase Authentication (Google OAuth) & HS256 JWT

## Architecture Overview

```text
React + Tailwind Frontend
   │
   ├── REST API (/api/*) ─────────┐
   └── WebSocket (/ws) ───────────┤
                                  ▼
                     Express + WS Server (Port 3000)
                      ├── Unified Auth Middleware (JWT & Firebase Admin)
                      ├── Zod Schema Validation & Latency Telemetry
                      ├── PDF Chunker & Gemini RAG Service
                      └── Drizzle ORM Pool ──► PostgreSQL + pgvector
```

## Database Schema

Normalized relational tables defined in `src/db/schema.ts`:

- `users` — User profiles, auth provider (`google` | `password`), hashed credentials, and role (`admin` | `member`)
- `collections` — Shared organizational document collections
- `documents` — Uploaded PDF metadata, page/chunk counts, and indexing status (`processing` | `ready` | `failed`)
- `document_chunks` — Page-numbered text chunks and 768-dimension `vector` embeddings with an HNSW index
- `chat_threads` & `chat_messages` — Persistent RAG conversation history, stored JSONB citations, and response latency
- `notifications` & `notification_reads` — Broadcast team events with per-user read tracking
- `audit_logs` — Security and activity audit trail
- `api_metrics` — Per-endpoint HTTP and WebSocket latency records

## Prerequisites

- **Node.js** 20+ (tested on Node 22)
- **PostgreSQL** 15+ with the [`pgvector`](https://github.com/pgvector/pgvector) extension installed
- A **Gemini API key**
- A **Firebase project** with Google Sign-In enabled (configured in `firebase-applet-config.json`)

## Environment Variables

Create a `.env` file in the project root (refer to `.env.example`):

```env
GEMINI_API_KEY="your-gemini-api-key"
APP_URL="http://localhost:3000"
JWT_SECRET="optional-custom-jwt-signing-secret"

# PostgreSQL connection variables
SQL_HOST="localhost"
SQL_DB_NAME="verity_vault"
SQL_USER="app_user"
SQL_PASSWORD="app_password"
SQL_ADMIN_USER="postgres"
SQL_ADMIN_PASSWORD="admin_password"
```

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Enable `pgvector` in PostgreSQL**
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

3. **Push the database schema**
   ```bash
   npx drizzle-kit push --config=src/db/drizzle.config.ts
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```
   The Express API, WebSocket server, and Vite frontend will be available at `http://localhost:3000`.

## Available Scripts

- `npm run dev` — Starts the full-stack Express + Vite development server on port `3000`
- `npm run build` — Builds the production frontend bundle into `dist/`
- `npm run start` — Runs the server entrypoint
- `npm run lint` — Runs TypeScript type-checking (`tsc --noEmit`)

## API Overview

| Endpoint | Auth | Description |
| --- | --- | --- |
| `POST /api/auth/register` | Public | Register an email/password account |
| `POST /api/auth/login` | Public | Authenticate with email/password |
| `POST /api/auth/google` | Public | Exchange Firebase Google ID token |
| `GET /api/auth/me` | Bearer | Fetch current authenticated user |
| `GET / POST /api/collections` | Bearer | List or create shared collections |
| `GET /api/documents` | Bearer | List uploaded PDFs (filterable by `collectionId`) |
| `POST /api/documents/upload` | Bearer | Upload and index a PDF (`multipart/form-data`) |
| `GET /api/documents/:id/chunks` | Bearer | Inspect indexed chunks and page numbers |
| `DELETE /api/documents/:id` | Owner / Admin | Delete a document and cascade chunks |
| `GET /api/threads` | Bearer | List user RAG conversation threads |
| `GET / DELETE /api/threads/:id` | Bearer | Load or delete a conversation thread |
| `POST /api/rag/query` | Bearer | Non-streaming RAG query fallback |
| `GET /api/notifications` | Bearer | List team notifications |
| `POST /api/notifications/read` | Bearer | Mark notifications as read |
| `GET /api/admin/observability` | Admin | Metrics, latency percentiles, and audit logs |
| `GET /api/admin/users` | Admin | List workspace members |
| `PATCH /api/admin/users/:id/role` | Admin | Promote or demote a member's role |
| `WS /ws?token=...` | Bearer | Real-time RAG streaming (`rag:ask`) and live events |
