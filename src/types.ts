export type UserRole = 'admin' | 'member';

export interface User {
  id: number;
  uid: string;
  email: string;
  name: string;
  authProvider: string;
  role: UserRole;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Collection {
  id: number;
  name: string;
  description: string;
  createdBy: number | null;
  creatorName: string | null;
  documentCount: number;
  createdAt: string;
}

export interface DocumentItem {
  id: number;
  collectionId: number;
  collectionName: string;
  uploadedBy: number | null;
  uploaderName: string | null;
  uploaderEmail: string | null;
  title: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  chunkCount: number;
  status: 'processing' | 'ready' | 'failed';
  errorMessage: string | null;
  createdAt: string;
}

export interface DocumentChunkPreview {
  id: number;
  pageNumber: number;
  chunkIndex: number;
  content: string;
}

export interface Citation {
  index: number;
  chunkId: number;
  documentId: number;
  documentTitle: string;
  pageNumber: number;
  snippet: string;
  score: number;
}

export interface ChatThread {
  id: number;
  title: string;
  collectionId: number | null;
  collectionName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  threadId: number;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  latencyMs: number | null;
  createdAt: string;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string;
  resourceId: string | null;
  actorName: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogItem {
  id: number;
  actorId: number | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  status: 'success' | 'failure';
  createdAt: string;
}

export interface ObservabilityData {
  summary: {
    totalUsers: number;
    totalDocuments: number;
    totalChunks: number;
    totalQueries: number;
    meanLatencyMs: number;
    p95LatencyMs: number;
    requests24h: number;
    serverErrors24h: number;
  };
  activeConnections: number;
  endpointBreakdown: Array<{
    endpoint: string;
    requests: number;
    avgLatencyMs: number;
    maxLatencyMs: number;
    errorCount: number;
  }>;
  latencySeries: Array<{
    id: number;
    label: string;
    latencyMs: number;
    statusCode: number;
    createdAt: string;
  }>;
  auditLogs: AuditLogItem[];
}

export interface WsServerMessage {
  event: string;
  data: any;
  timestamp?: string;
}
