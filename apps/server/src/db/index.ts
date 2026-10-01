import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";
import type { Env } from "../env.ts";
import { DEFAULT_SYSTEM_PROMPT } from "@wlfv/shared";
import { inferMemoryPath } from "../memory-ops.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function openDb(env: Env) {
  const file = path.isAbsolute(env.databaseUrl) ? env.databaseUrl : path.resolve(root, env.databaseUrl);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      ollama_model TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon_path TEXT,
      icon_type TEXT,
      family TEXT NOT NULL DEFAULT 'other',
      enabled INTEGER NOT NULL DEFAULT 0,
      thinking_supported INTEGER NOT NULL DEFAULT 0,
      thinking_levels TEXT NOT NULL DEFAULT '[]',
      think_values TEXT NOT NULL DEFAULT '[]',
      vision_supported INTEGER NOT NULL DEFAULT 0,
      tools_supported INTEGER NOT NULL DEFAULT 0,
      structured_output_supported INTEGER NOT NULL DEFAULT 0,
      context_length INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      missing INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_category_members (
      model_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      PRIMARY KEY (model_id, category_id)
    );
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'folder',
      icon_color TEXT NOT NULL DEFAULT '#C9864A',
      system_prompt TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New chat',
      model_id TEXT,
      folder_id TEXT,
      thinking_enabled INTEGER NOT NULL DEFAULT 0,
      thinking_level TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      unread INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      thinking TEXT,
      model_id TEXT,
      status TEXT NOT NULL DEFAULT 'complete',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_ledger (
      message_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      model_id TEXT,
      role TEXT NOT NULL DEFAULT 'assistant',
      tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      default_on INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      memory_type TEXT NOT NULL DEFAULT 'user',
      path TEXT NOT NULL DEFAULT '',
      importance INTEGER NOT NULL DEFAULT 50,
      source_conversation_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT NOT NULL DEFAULT 'dark',
      compact INTEGER NOT NULL DEFAULT 0,
      animations INTEGER NOT NULL DEFAULT 1,
      memory_enabled INTEGER NOT NULL DEFAULT 1,
      default_model_id TEXT,
      default_thinking INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'en',
      show_usage INTEGER NOT NULL DEFAULT 1,
      instruction_tone TEXT NOT NULL DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tool_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT,
      tool TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_tool_runs_user ON tool_runs(user_id, created_at);
  `);
  const memoryCols = sqlite.prepare("PRAGMA table_info(memories)").all() as { name: string }[];
  if (!memoryCols.some((col) => col.name === "memory_type")) {
    sqlite.exec("ALTER TABLE memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'user'");
  }
  if (!memoryCols.some((col) => col.name === "path")) {
    sqlite.exec("ALTER TABLE memories ADD COLUMN path TEXT NOT NULL DEFAULT ''");
  }
  const needsPathFill = sqlite.prepare("SELECT id, content, category, path FROM memories WHERE path = '' OR path IS NULL").all() as {
    id: string;
    content: string;
    category: string;
    path: string;
  }[];
  const fillPath = sqlite.prepare("UPDATE memories SET path = ? WHERE id = ?");
  for (const row of needsPathFill) {
    const pathValue = inferMemoryPath(row.content, row.category);
    if (pathValue) fillPath.run(pathValue, row.id);
  }
  const modelCols = sqlite.prepare("PRAGMA table_info(model_configs)").all() as { name: string }[];
  if (!modelCols.some((col) => col.name === "category_id")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN category_id TEXT");
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS model_category_members (
      model_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      PRIMARY KEY (model_id, category_id)
    )
  `);
  sqlite.exec(`
    INSERT OR IGNORE INTO model_category_members (model_id, category_id)
    SELECT id, category_id FROM model_configs
    WHERE category_id IS NOT NULL AND category_id != ''
  `);
  const messageCols = sqlite.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!messageCols.some((col) => col.name === "stats")) {
    sqlite.exec("ALTER TABLE messages ADD COLUMN stats TEXT");
  }
  if (!messageCols.some((col) => col.name === "sources")) {
    sqlite.exec("ALTER TABLE messages ADD COLUMN sources TEXT");
  }
  if (!messageCols.some((col) => col.name === "activities")) {
    sqlite.exec("ALTER TABLE messages ADD COLUMN activities TEXT");
  }
  const settingCols = sqlite.prepare("PRAGMA table_info(user_settings)").all() as { name: string }[];
  if (!settingCols.some((col) => col.name === "show_usage")) {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN show_usage INTEGER NOT NULL DEFAULT 1");
  }
  if (!settingCols.some((col) => col.name === "animations")) {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN animations INTEGER NOT NULL DEFAULT 1");
  }
  if (!settingCols.some((col) => col.name === "text_size")) {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN text_size INTEGER NOT NULL DEFAULT 100");
  }
  if (!settingCols.some((col) => col.name === "system_prompt")) {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''");
  }
  if (!settingCols.some((col) => col.name === "generation_params")) {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN generation_params TEXT NOT NULL DEFAULT '{}'");
  }
  if (!settingCols.some((col) => col.name === "instruction_tone")) {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN instruction_tone TEXT NOT NULL DEFAULT 'default'");
  }
  if (!settingCols.some((col) => col.name === "instruction_extra")) {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN instruction_extra TEXT NOT NULL DEFAULT ''");
  }
  const skillCols = sqlite.prepare("PRAGMA table_info(skills)").all() as { name: string }[];
  if (!skillCols.some((col) => col.name === "default_on")) {
    sqlite.exec("ALTER TABLE skills ADD COLUMN default_on INTEGER NOT NULL DEFAULT 0");
  }
  if (!modelCols.some((col) => col.name === "kind")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN kind TEXT NOT NULL DEFAULT 'installed'");
  }
  if (!modelCols.some((col) => col.name === "system_prompt")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''");
  }
  if (!modelCols.some((col) => col.name === "base_model_id")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN base_model_id TEXT");
  }
  if (!modelCols.some((col) => col.name === "connection_id")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN connection_id TEXT");
  }
  if (!modelCols.some((col) => col.name === "provider_kind")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'ollama'");
  }
  if (!modelCols.some((col) => col.name === "remote_model")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN remote_model TEXT");
  }
  if (!modelCols.some((col) => col.name === "hidden")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
  }
  if (!modelCols.some((col) => col.name === "is_public")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1");
  }
  if (!modelCols.some((col) => col.name === "is_main")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0");
  }
  if (!modelCols.some((col) => col.name === "generation_params")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN generation_params TEXT NOT NULL DEFAULT '{}'");
  }
  if (!modelCols.some((col) => col.name === "default_tools")) {
    sqlite.exec("ALTER TABLE model_configs ADD COLUMN default_tools TEXT NOT NULL DEFAULT '{}'");
  }
  const conversationCols = sqlite.prepare("PRAGMA table_info(conversations)").all() as { name: string }[];
  if (!conversationCols.some((col) => col.name === "folder_id")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN folder_id TEXT");
  }
  if (!conversationCols.some((col) => col.name === "pinned")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  }
  if (!conversationCols.some((col) => col.name === "unread")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN unread INTEGER NOT NULL DEFAULT 0");
  }
  const userCols = sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some((col) => col.name === "display_name")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
    sqlite.exec("UPDATE users SET display_name = username WHERE display_name = ''");
  }
  if (!userCols.some((col) => col.name === "bio")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.some((col) => col.name === "gender")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.some((col) => col.name === "birthday")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN birthday TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.some((col) => col.name === "plan")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'");
  }
  if (!userCols.some((col) => col.name === "usage_reset_at")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN usage_reset_at INTEGER NOT NULL DEFAULT 0");
  }
  const seeded = sqlite.prepare("SELECT key FROM app_settings WHERE key = 'default_system_prompt_v1'").get();
  if (!seeded) {
    sqlite.prepare("UPDATE user_settings SET system_prompt = ?").run(DEFAULT_SYSTEM_PROMPT);
    sqlite.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('default_system_prompt_v1', '1', ?)").run(Date.now());
  }
  sqliteHandle = sqlite;
  sqlitePath = file;
  return drizzle(sqlite, { schema });
}

let sqliteHandle: Database.Database | null = null;
let sqlitePath = "";

export function databasePath() {
  return sqlitePath;
}

export function checkpointDatabase() {
  sqliteHandle?.pragma("wal_checkpoint(TRUNCATE)");
}

export type DB = ReturnType<typeof openDb>;
