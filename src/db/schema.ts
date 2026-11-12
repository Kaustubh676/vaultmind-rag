import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

export interface CitationRecord {
  index: number;
  chunkId: number;
  documentId: number;
  documentTitle: string;
  pageNumber: number;
  snippet: string;
  score: number;
}

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  authProvider: text('auth_provider').notNull().default('password'), // 'google' | 'password'
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const collections = pgTable('collections', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdBy: integer('created_by')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  collectionId: integer('collection_id')
    .references(() => collections.id, { onDelete: 'cascade' })
    .notNull(),
  uploadedBy: integer('uploaded_by')
    .references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  pageCount: integer('page_count').notNull().default(0),
  chunkCount: integer('chunk_count').notNull().default(0),
  status: text('status').notNull().default('processing'), // 'processing' | 'ready' | 'failed'
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: serial('id').primaryKey(),
    documentId: integer('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    pageNumber: integer('page_number').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('document_chunks_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    ),
    index('document_chunks_document_id_idx').on(table.documentId),
  ]
);

export const chatThreads = pgTable('chat_threads', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  collectionId: integer('collection_id').references(() => collections.id, {
    onDelete: 'set null',
  }),
  title: text('title').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  threadId: integer('thread_id')
    .references(() => chatThreads.id, { onDelete: 'cascade' })
    .notNull(),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  citations: jsonb('citations').$type<CitationRecord[]>().notNull().default([]),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  actorId: integer('actor_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  type: text('type').notNull(), // 'document.indexed' | 'collection.created' | 'role.updated'
  title: text('title').notNull(),
  message: text('message').notNull(),
  resourceId: text('resource_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notificationReads = pgTable(
  'notification_reads',
  {
    id: serial('id').primaryKey(),
    notificationId: integer('notification_id')
      .references(() => notifications.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    readAt: timestamp('read_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('notification_reads_unique_idx').on(
      table.notificationId,
      table.userId
    ),
  ]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('success'), // 'success' | 'failure'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_created_at_idx').on(table.createdAt),
  ]
);

export const apiMetrics = pgTable(
  'api_metrics',
  {
    id: serial('id').primaryKey(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    statusCode: integer('status_code').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('api_metrics_created_at_idx').on(table.createdAt)]
);

export const usersRelations = relations(users, ({ many }) => ({
  collections: many(collections),
  documents: many(documents),
  chatThreads: many(chatThreads),
  notifications: many(notifications),
  notificationReads: many(notificationReads),
  auditLogs: many(auditLogs),
  apiMetrics: many(apiMetrics),
}));

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  creator: one(users, {
    fields: [collections.createdBy],
    references: [users.id],
  }),
  documents: many(documents),
  chatThreads: many(chatThreads),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  collection: one(collections, {
    fields: [documents.collectionId],
    references: [collections.id],
  }),
  uploader: one(users, {
    fields: [documents.uploadedBy],
    references: [users.id],
  }),
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
}));

export const chatThreadsRelations = relations(chatThreads, ({ one, many }) => ({
  user: one(users, {
    fields: [chatThreads.userId],
    references: [users.id],
  }),
  collection: one(collections, {
    fields: [chatThreads.collectionId],
    references: [collections.id],
  }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  thread: one(chatThreads, {
    fields: [chatMessages.threadId],
    references: [chatThreads.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one, many }) => ({
  actor: one(users, {
    fields: [notifications.actorId],
    references: [users.id],
  }),
  reads: many(notificationReads),
}));

export const notificationReadsRelations = relations(notificationReads, ({ one }) => ({
  notification: one(notifications, {
    fields: [notificationReads.notificationId],
    references: [notifications.id],
  }),
  user: one(users, {
    fields: [notificationReads.userId],
    references: [users.id],
  }),
}));
