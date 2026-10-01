import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull().default(""),
  bio: text("bio").notNull().default(""),
  gender: text("gender").notNull().default(""),
  birthday: text("birthday").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  plan: text("plan").notNull().default("free"),
  usageResetAt: integer("usage_reset_at").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  lastLoginAt: integer("last_login_at"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const modelConfigs = sqliteTable("model_configs", {
  id: text("id").primaryKey(),
  ollamaModel: text("ollama_model").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description").notNull().default(""),
  iconPath: text("icon_path"),
  iconType: text("icon_type"),
  family: text("family").notNull().default("other"),
  enabled: integer("enabled").notNull().default(0),
  thinkingSupported: integer("thinking_supported").notNull().default(0),
  thinkingLevels: text("thinking_levels").notNull().default("[]"),
  thinkValues: text("think_values").notNull().default("[]"),
  visionSupported: integer("vision_supported").notNull().default(0),
  toolsSupported: integer("tools_supported").notNull().default(0),
  structuredOutputSupported: integer("structured_output_supported").notNull().default(0),
  contextLength: integer("context_length"),
  sortOrder: integer("sort_order").notNull().default(0),
  missing: integer("missing").notNull().default(0),
  categoryId: text("category_id"),
  kind: text("kind").notNull().default("installed"),
  systemPrompt: text("system_prompt").notNull().default(""),
  baseModelId: text("base_model_id"),
  connectionId: text("connection_id"),
  providerKind: text("provider_kind").notNull().default("ollama"),
  remoteModel: text("remote_model"),
  hidden: integer("hidden").notNull().default(0),
  isPublic: integer("is_public").notNull().default(1),
  isMain: integer("is_main").notNull().default(0),
  generationParams: text("generation_params").notNull().default("{}"),
  defaultTools: text("default_tools").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const modelCategories = sqliteTable("model_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const modelCategoryMembers = sqliteTable(
  "model_category_members",
  {
    modelId: text("model_id").notNull(),
    categoryId: text("category_id").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.modelId, table.categoryId] }),
  }),
);

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  icon: text("icon").notNull().default("folder"),
  iconColor: text("icon_color").notNull().default("#C9864A"),
  systemPrompt: text("system_prompt").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  modelId: text("model_id"),
  folderId: text("folder_id"),
  thinkingEnabled: integer("thinking_enabled").notNull().default(0),
  thinkingLevel: text("thinking_level"),
  archived: integer("archived").notNull().default(0),
  pinned: integer("pinned").notNull().default(0),
  unread: integer("unread").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  thinking: text("thinking"),
  modelId: text("model_id"),
  status: text("status").notNull().default("complete"),
  stats: text("stats"),
  sources: text("sources"),
  activities: text("activities"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const usageLedger = sqliteTable("usage_ledger", {
  messageId: text("message_id").primaryKey(),
  userId: text("user_id").notNull(),
  conversationId: text("conversation_id"),
  modelId: text("model_id"),
  role: text("role").notNull().default("assistant"),
  tokens: integer("tokens").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  content: text("content").notNull().default(""),
  defaultOn: integer("default_on").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  category: text("category").notNull().default("other"),
  memoryType: text("memory_type").notNull().default("user"),
  path: text("path").notNull().default(""),
  importance: integer("importance").notNull().default(50),
  sourceConversationId: text("source_conversation_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("dark"),
  compact: integer("compact").notNull().default(0),
  animations: integer("animations").notNull().default(1),
  memoryEnabled: integer("memory_enabled").notNull().default(1),
  defaultModelId: text("default_model_id"),
  defaultThinking: integer("default_thinking").notNull().default(0),
  language: text("language").notNull().default("en"),
  showUsage: integer("show_usage").notNull().default(1),
  textSize: integer("text_size").notNull().default(100),
  systemPrompt: text("system_prompt").notNull().default(""),
  instructionTone: text("instruction_tone").notNull().default("default"),
  instructionExtra: text("instruction_extra").notNull().default(""),
  generationParams: text("generation_params").notNull().default("{}"),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const toolRuns = sqliteTable("tool_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id"),
  tool: text("tool").notNull(),
  createdAt: integer("created_at").notNull(),
});
