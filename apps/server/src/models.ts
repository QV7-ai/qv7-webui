import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { detectModelFamily, FAMILY_LABELS, parseGenerationSettings, type ChatModel, type ModelCategory, type ModelDefaults } from "@wlfv/shared";
import { modelCategories, modelCategoryMembers, modelConfigs } from "./db/schema.ts";
import type { DB } from "./db/index.ts";
import { requireAdmin, requireUser } from "./auth.ts";
import { contextLengthFromShow, parseShowCapabilities } from "./services/ollama/capabilities.ts";
import { publicErrorMessage } from "./services/ollama/errors.ts";
import { OllamaError } from "./services/ollama/errors.ts";
import { removeStoredIcon, saveModelIcon, resolveUploadsDir } from "./uploads.ts";
import { clientForOllama, clientForOpenAI, firstOllamaClient } from "./runtime.ts";
import { loadConnections, remoteModelName, resolveConnectionModelIds, storageModelKey } from "./connections.ts";
import type { Env } from "./env.ts";
import type { ProviderConnection } from "@wlfv/shared";

function prettyName(id: string) {
  return id.replace(/:latest$/, "").replace(/[:\-_]/g, " ");
}

function parseDefaultTools(raw: string | null | undefined): ModelDefaults {
  try {
    const data = JSON.parse(raw || "{}") as Record<string, unknown>;
    const level = typeof data.thinkingLevel === "string" ? data.thinkingLevel : undefined;
    return {
      thinking: Boolean(data.thinking),
      thinkingLevel: level || undefined,
      webSearch: Boolean(data.webSearch),
      codeInterpreter: Boolean(data.codeInterpreter),
    };
  } catch {
    return {};
  }
}

function storeDefaultTools(value: unknown) {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const level = typeof data.thinkingLevel === "string" ? data.thinkingLevel.trim() : "";
  return JSON.stringify({
    thinking: Boolean(data.thinking),
    thinkingLevel: level,
    webSearch: Boolean(data.webSearch),
    codeInterpreter: Boolean(data.codeInterpreter),
  });
}

function listCategories(db: DB): ModelCategory[] {
  return db
    .select()
    .from(modelCategories)
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((row) => ({ id: row.id, name: row.name, sortOrder: row.sortOrder }));
}

function membersByModel(db: DB) {
  const map = new Map<string, string[]>();
  for (const row of db.select().from(modelCategoryMembers).all()) {
    const list = map.get(row.modelId) ?? [];
    if (!list.includes(row.categoryId)) list.push(row.categoryId);
    map.set(row.modelId, list);
  }
  return map;
}

function orderedCategoryIds(raw: string[], listed: ModelCategory[]) {
  const want = new Set(raw.filter(Boolean));
  const ids = listed.filter((item) => want.has(item.id)).map((item) => item.id);
  for (const id of want) if (!ids.includes(id)) ids.push(id);
  return ids;
}

function categoryIdsFor(
  row: typeof modelConfigs.$inferSelect,
  listed: ModelCategory[],
  members: Map<string, string[]>,
) {
  const raw = members.get(row.id) ?? (row.categoryId ? [row.categoryId] : []);
  return orderedCategoryIds(raw, listed);
}

function setModelCategories(db: DB, modelId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  db.delete(modelCategoryMembers).where(eq(modelCategoryMembers.modelId, modelId)).run();
  for (const categoryId of unique) {
    db.insert(modelCategoryMembers).values({ modelId, categoryId }).run();
  }
  db.update(modelConfigs)
    .set({ categoryId: unique[0] ?? null, updatedAt: Date.now() })
    .where(eq(modelConfigs.id, modelId))
    .run();
}

function resolveCategoryIds(
  db: DB,
  body: { categoryIds?: unknown; categoryId?: string | null },
): string[] | undefined {
  if (body.categoryIds !== undefined) {
    const ids = (Array.isArray(body.categoryIds) ? body.categoryIds : []).map((item) => String(item || "").trim()).filter(Boolean);
    for (const id of ids) {
      const category = db.select().from(modelCategories).where(eq(modelCategories.id, id)).get();
      if (!category) throw new Error("Category not found.");
    }
    return [...new Set(ids)];
  }
  if (body.categoryId !== undefined) {
    if (!body.categoryId) return [];
    const category = db.select().from(modelCategories).where(eq(modelCategories.id, body.categoryId)).get();
    if (!category) throw new Error("Category not found.");
    return [body.categoryId];
  }
  return undefined;
}

function toChatModel(
  row: typeof modelConfigs.$inferSelect,
  listed: ModelCategory[],
  members: Map<string, string[]>,
): ChatModel {
  const levels = JSON.parse(row.thinkingLevels || "[]") as string[];
  const categories = new Map(listed.map((item) => [item.id, item]));
  const ids = categoryIdsFor(row, listed, members).filter((id) => categories.has(id));
  const names = ids.map((id) => categories.get(id)!.name);
  return {
    id: row.id,
    displayName: row.displayName,
    description: row.description || undefined,
    iconUrl: row.iconPath ? `/api/uploads/${row.iconPath}?t=${row.updatedAt}` : undefined,
    family: (row.family as ChatModel["family"]) || detectModelFamily(row.ollamaModel),
    categoryId: ids[0],
    categoryName: names[0],
    categoryIds: ids,
    categoryNames: names,
    kind: row.kind === "custom" ? "custom" : "installed",
    capabilities: {
      thinking: Boolean(row.thinkingSupported),
      thinkingLevels: Array.isArray(levels) ? levels : [],
      vision: Boolean(row.visionSupported),
      tools: Boolean(row.toolsSupported),
      structuredOutput: Boolean(row.structuredOutputSupported),
    },
    defaults: parseDefaultTools(row.defaultTools),
    contextLength: row.contextLength && row.contextLength > 0 ? row.contextLength : undefined,
    numCtx: modelNumCtx(row),
  };
}

function modelNumCtx(row: typeof modelConfigs.$inferSelect) {
  let generation = parseGenerationSettings({});
  try {
    generation = parseGenerationSettings(JSON.parse(row.generationParams || "{}"));
  } catch {
    generation = parseGenerationSettings({});
  }
  const fromParams = Number(generation.values.num_ctx);
  if (Number.isFinite(fromParams) && fromParams > 0) return Math.round(fromParams);
  return undefined;
}

function toAdminModel(row: typeof modelConfigs.$inferSelect, listed: ModelCategory[], members: Map<string, string[]>) {
  let generation = parseGenerationSettings({});
  try {
    generation = parseGenerationSettings(JSON.parse(row.generationParams || "{}"));
  } catch {
    generation = parseGenerationSettings({});
  }
  return {
    ...toChatModel(row, listed, members),
    ollamaModel: row.ollamaModel,
    originalName: row.remoteModel || row.ollamaModel,
    familyLabel: FAMILY_LABELS[detectModelFamily(row.remoteModel || row.ollamaModel)],
    enabled: Boolean(row.enabled),
    missing: Boolean(row.missing),
    hidden: Boolean(row.hidden),
    isPublic: row.isPublic !== 0,
    isMain: Boolean(row.isMain),
    sortOrder: row.sortOrder,
    kind: row.kind === "custom" ? "custom" : "installed",
    providerKind: row.providerKind === "openai" ? "openai" : "ollama",
    systemPrompt: row.systemPrompt || "",
    baseModelId: row.baseModelId || undefined,
    generation,
  };
}

function mapAdminModels(db: DB, rows: (typeof modelConfigs.$inferSelect)[]) {
  const listed = listCategories(db);
  const members = membersByModel(db);
  return rows.map((row) => toAdminModel(row, listed, members));
}

function mapChatModels(db: DB, rows: (typeof modelConfigs.$inferSelect)[]) {
  const listed = listCategories(db);
  const members = membersByModel(db);
  return rows.map((row) => toChatModel(row, listed, members));
}

function oneAdminModel(db: DB, row: typeof modelConfigs.$inferSelect) {
  return toAdminModel(row, listCategories(db), membersByModel(db));
}

function copyRuntime(from: typeof modelConfigs.$inferSelect) {
  return {
    thinkingSupported: from.thinkingSupported,
    thinkingLevels: from.thinkingLevels,
    thinkValues: from.thinkValues,
    visionSupported: from.visionSupported,
    toolsSupported: from.toolsSupported,
    structuredOutputSupported: from.structuredOutputSupported,
    family: from.family,
  };
}

export function resolveOllamaModel(db: DB, model: typeof modelConfigs.$inferSelect) {
  const raw = (() => {
    if (model.kind === "custom" && model.baseModelId) {
      const base = db.select().from(modelConfigs).where(eq(modelConfigs.id, model.baseModelId)).get();
      if (base) return base.remoteModel || (base.ollamaModel.startsWith("custom:") ? "" : base.ollamaModel);
    }
    return model.remoteModel || (model.ollamaModel.startsWith("custom:") ? "" : model.ollamaModel);
  })();
  const stored = raw.match(/^(?:openai|ollama):[^:]+:(.+)$/);
  return stored?.[1] || raw;
}

export function resolveModelConnection(db: DB, model: typeof modelConfigs.$inferSelect) {
  if (model.kind === "custom" && model.baseModelId) {
    return db.select().from(modelConfigs).where(eq(modelConfigs.id, model.baseModelId)).get() ?? model;
  }
  return model;
}

function ollamaNameKeys(name: string) {
  const value = name.trim().toLowerCase();
  if (!value) return new Set<string>();
  const keys = new Set([value]);
  if (!value.includes(":")) keys.add(`${value}:latest`);
  else if (value.endsWith(":latest")) keys.add(value.slice(0, -7));
  return keys;
}

function ollamaNamesMatch(left: string, right: string) {
  const a = ollamaNameKeys(left);
  for (const key of ollamaNameKeys(right)) {
    if (a.has(key)) return true;
  }
  return false;
}

export async function listLoadedModels(db: DB, env: Env) {
  const config = loadConnections(db, env);
  const running = new Map<string, number | undefined>();
  if (config.ollamaEnabled) {
    await Promise.all(
      config.ollama
        .filter((conn) => conn.enabled && conn.url)
        .map(async (conn) => {
          try {
            const listed = await clientForOllama(conn).ps();
            const prefix = conn.prefixId?.trim();
            for (const item of listed) {
              const raw =
                prefix && item.name.toLowerCase().startsWith(`${prefix.toLowerCase()}.`) ? item.name.slice(prefix.length + 1) : item.name;
              const previous = running.get(raw);
              running.set(raw, item.contextLength || previous);
            }
          } catch {
            /* connection may be down */
          }
        }),
    );
  }
  const ids: string[] = [];
  const contexts: Record<string, number> = {};
  if (!running.size) return { ids, contexts };
  for (const row of db.select().from(modelConfigs).all()) {
    const remote = resolveOllamaModel(db, row);
    if (!remote) continue;
    for (const [name, length] of running) {
      if (!ollamaNamesMatch(remote, name)) continue;
      ids.push(row.id);
      if (length) contexts[row.id] = length;
      break;
    }
  }
  return { ids, contexts };
}

export async function listLoadedModelIds(db: DB, env: Env) {
  const loaded = await listLoadedModels(db, env);
  return loaded.ids;
}

export async function syncConnectionModels(db: DB, env: Env) {
  const config = loadConnections(db, env);
  const uploadsDir = resolveUploadsDir(env.uploadsDir);
  const now = Date.now();
  const existing = db.select().from(modelConfigs).all();
  const byKey = new Map(existing.filter((r) => r.kind !== "custom").map((r) => [r.ollamaModel, r]));
  const seen = new Set<string>();
  const synced = new Set<string>();
  let created = existing.length;

  async function ingest(conn: ProviderConnection, names: string[], kind: "ollama" | "openai") {
    for (const name of names) {
      const key = storageModelKey(conn, name);
      seen.add(key);
      let detected = parseShowCapabilities({});
      let contextLength: number | undefined;
      if (kind === "ollama") {
        try {
          const show = await clientForOllama(conn).show(name);
          detected = parseShowCapabilities(show);
          contextLength = contextLengthFromShow(show);
        } catch {
          detected = parseShowCapabilities({});
        }
      }
      const current = byKey.get(key);
      const payload = {
        thinkingSupported: detected.thinking === true ? 1 : 0,
        thinkingLevels: JSON.stringify(detected.thinkingLevels),
        thinkValues: JSON.stringify(detected.thinkValues),
        visionSupported: detected.vision === true ? 1 : 0,
        toolsSupported: detected.tools === true ? 1 : 0,
        structuredOutputSupported: detected.structuredOutput === true ? 1 : 0,
        family: detectModelFamily(name),
        ...(contextLength ? { contextLength } : {}),
        missing: 0,
        connectionId: conn.id,
        providerKind: kind,
        remoteModel: name,
        updatedAt: now,
      };
      if (!current) {
        db.insert(modelConfigs)
          .values({
            id: randomUUID(),
            ollamaModel: key,
            displayName: prettyName(remoteModelName(conn, name)),
            description: "",
            enabled: 0,
            kind: "installed",
            systemPrompt: "",
            sortOrder: created++,
            createdAt: now,
            ...payload,
          })
          .run();
      } else {
        db.update(modelConfigs).set(payload).where(eq(modelConfigs.id, current.id)).run();
      }
    }
  }

  if (config.ollamaEnabled) {
    for (const conn of config.ollama.filter((item) => item.enabled && item.url)) {
      try {
        const listed = await clientForOllama(conn).tags().catch(() => [] as string[]);
        const names = await resolveConnectionModelIds(conn, listed);
        if (!names.length) continue;
        await ingest(conn, names, "ollama");
        synced.add(conn.id);
      } catch {
        /* skip unreachable ollama connection */
      }
    }
  }
  if (config.openaiEnabled) {
    for (const conn of config.openai.filter((item) => item.enabled && item.url)) {
      try {
        const listed = await clientForOpenAI(conn).listModels().catch(() => [] as string[]);
        const names = await resolveConnectionModelIds(conn, listed);
        if (!names.length) continue;
        await ingest(conn, names, "openai");
        synced.add(conn.id);
      } catch {
        /* skip unreachable openai connection */
      }
    }
  }

  const installed = db.select().from(modelConfigs).all();
  const installedById = new Map(installed.map((r) => [r.id, r]));
  const usedAsBase = new Set(installed.filter((row) => row.kind === "custom" && row.baseModelId).map((row) => row.baseModelId as string));
  for (const row of installed) {
    if (row.kind === "custom") {
      const base = row.baseModelId ? installedById.get(row.baseModelId) : undefined;
      const missing = !base || Boolean(base.missing) || !seen.has(base.ollamaModel) ? 1 : 0;
      const runtime = base ? copyRuntime(base) : {};
      db.update(modelConfigs)
        .set({ missing, updatedAt: now, ...runtime })
        .where(eq(modelConfigs.id, row.id))
        .run();
    } else if (!seen.has(row.ollamaModel)) {
      const stale = Boolean(row.connectionId && synced.has(row.connectionId));
      if (stale && !usedAsBase.has(row.id)) {
        removeStoredIcon(uploadsDir, row.iconPath);
        db.delete(modelConfigs).where(eq(modelConfigs.id, row.id)).run();
      } else {
        db.update(modelConfigs).set({ missing: 1, updatedAt: now }).where(eq(modelConfigs.id, row.id)).run();
      }
    }
  }
  return db.select().from(modelConfigs).all();
}

export const syncOllamaModels = syncConnectionModels;

export function registerModels(app: FastifyInstance, db: DB, env: Env, uploadsDir: string) {
  app.get("/api/models", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const rows = db
      .select()
      .from(modelConfigs)
      .all()
      .filter((r) => r.enabled && !r.missing && !r.hidden && (r.isPublic !== 0 || user.role === "admin"));
    rows.sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
    const main = db.select().from(modelConfigs).all().find((r) => r.isMain);
    return { models: mapChatModels(db, rows), categories: listCategories(db), defaultModelId: main && rows.some((r) => r.id === main.id) ? main.id : rows[0]?.id ?? null };
  });

  app.get("/api/models/loaded", async (req, reply) => {
    const user = await requireUser(req, reply, db);
    if (!user) return;
    const loaded = await listLoadedModels(db, env);
    return loaded;
  });

  app.post("/api/admin/models/:id/unload", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const id = String((req.params as { id: string }).id || "");
    const row = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Model not found." });
    if (row.providerKind === "openai") {
      return reply.code(400).send({ error: "OpenAI-compatible models cannot be unloaded from Ollama." });
    }
    const remote = resolveOllamaModel(db, row);
    if (!remote) return reply.code(400).send({ error: "This model has no Ollama name to unload." });
    const config = loadConnections(db, env);
    if (!config.ollamaEnabled) return reply.code(400).send({ error: "Ollama is not enabled." });
    let found = false;
    let lastError: unknown;
    for (const conn of config.ollama.filter((item) => item.enabled && item.url)) {
      try {
        const client = clientForOllama(conn);
        const names = (await client.ps()).map((item) => item.name);
        const prefix = conn.prefixId?.trim();
        for (const name of names) {
          const raw =
            prefix && name.toLowerCase().startsWith(`${prefix.toLowerCase()}.`) ? name.slice(prefix.length + 1) : name;
          if (!ollamaNamesMatch(remote, raw)) continue;
          found = true;
          await client.unload(name);
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (!found) {
      if (lastError) {
        const code = lastError instanceof OllamaError ? lastError.code : "OLLAMA_UNAVAILABLE";
        return reply.code(502).send({ error: publicErrorMessage(code) });
      }
      return reply.code(409).send({ error: "This model is not loaded." });
    }
    const ids = await listLoadedModelIds(db, env);
    return { ok: true, ids };
  });

  app.get("/api/admin/models", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    let rows = db.select().from(modelConfigs).all();
    if (!rows.length) {
      try {
        rows = await syncConnectionModels(db, env);
      } catch (error) {
        const code = error instanceof OllamaError ? error.code : "OLLAMA_UNAVAILABLE";
        return reply.code(502).send({ error: publicErrorMessage(code) });
      }
    }
    return { models: mapAdminModels(db, rows.filter((row) => !row.missing)), categories: listCategories(db) };
  });

  app.post("/api/admin/ollama/refresh", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    try {
      const rows = await syncConnectionModels(db, env);
      rows.sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
      return { models: mapAdminModels(db, rows.filter((row) => !row.missing)), categories: listCategories(db) };
    } catch (error) {
      const code = error instanceof OllamaError ? error.code : "OLLAMA_UNAVAILABLE";
      return reply.code(502).send({ error: publicErrorMessage(code) });
    }
  });

  app.post("/api/admin/models", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const body = req.body as {
      displayName?: string;
      description?: string;
      systemPrompt?: string;
      baseModelId?: string;
      categoryId?: string;
      categoryIds?: string[];
      enabled?: boolean;
      isPublic?: boolean;
      originalName?: string;
      generation?: unknown;
      thinkingSupported?: boolean;
      visionSupported?: boolean;
      toolsSupported?: boolean;
      structuredOutputSupported?: boolean;
      defaultTools?: unknown;
    };
    const displayName = body.displayName?.trim();
    if (!displayName) return reply.code(400).send({ error: "Enter a name." });
    if (!body.baseModelId) return reply.code(400).send({ error: "Choose a base model." });
    const base = db.select().from(modelConfigs).where(eq(modelConfigs.id, body.baseModelId)).get();
    if (!base || base.kind === "custom") return reply.code(400).send({ error: "Choose an installed Ollama model." });
    let categoryIds: string[] = [];
    try {
      categoryIds = resolveCategoryIds(db, body) ?? [];
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Category not found." });
    }
    const now = Date.now();
    const id = randomUUID();
    const runtime = copyRuntime(base);
    db.insert(modelConfigs)
      .values({
        id,
        ollamaModel: `custom:${id}`,
        displayName,
        description: body.description?.trim() || "",
        systemPrompt: body.systemPrompt?.trim() || "",
        kind: "custom",
        baseModelId: base.id,
        categoryId: categoryIds[0] ?? null,
        enabled: body.enabled === false ? 0 : 1,
        sortOrder: db.select().from(modelConfigs).all().length,
        missing: 0,
        connectionId: base.connectionId,
        providerKind: base.providerKind,
        remoteModel: body.originalName?.trim() || base.remoteModel || base.ollamaModel,
        isPublic: body.isPublic === false ? 0 : 1,
        generationParams: JSON.stringify(parseGenerationSettings(body.generation)),
        thinkingSupported: body.thinkingSupported == null ? runtime.thinkingSupported : body.thinkingSupported ? 1 : 0,
        thinkingLevels: runtime.thinkingLevels,
        thinkValues: runtime.thinkValues,
        visionSupported: body.visionSupported == null ? runtime.visionSupported : body.visionSupported ? 1 : 0,
        toolsSupported: body.toolsSupported == null ? runtime.toolsSupported : body.toolsSupported ? 1 : 0,
        structuredOutputSupported:
          body.structuredOutputSupported == null ? runtime.structuredOutputSupported : body.structuredOutputSupported ? 1 : 0,
        family: runtime.family,
        defaultTools: storeDefaultTools(body.defaultTools),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    setModelCategories(db, id, categoryIds);
    const next = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get()!;
    return { model: oneAdminModel(db, next) };
  });

  app.post("/api/admin/models/:id/clone", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Model not found." });
    if (row.kind !== "custom") return reply.code(400).send({ error: "Only custom models can be cloned." });
    const now = Date.now();
    const cloneId = randomUUID();
    db.insert(modelConfigs)
      .values({
        id: cloneId,
        ollamaModel: `custom:${cloneId}`,
        displayName: `${row.displayName} copy`,
        description: row.description,
        iconPath: null,
        iconType: null,
        family: row.family,
        enabled: 0,
        thinkingSupported: row.thinkingSupported,
        thinkingLevels: row.thinkingLevels,
        thinkValues: row.thinkValues,
        visionSupported: row.visionSupported,
        toolsSupported: row.toolsSupported,
        structuredOutputSupported: row.structuredOutputSupported,
        contextLength: row.contextLength,
        sortOrder: db.select().from(modelConfigs).all().length,
        missing: row.missing,
        categoryId: row.categoryId,
        kind: "custom",
        systemPrompt: row.systemPrompt,
        baseModelId: row.baseModelId,
        connectionId: row.connectionId,
        providerKind: row.providerKind,
        remoteModel: row.remoteModel,
        hidden: 0,
        isPublic: row.isPublic,
        isMain: 0,
        generationParams: row.generationParams,
        defaultTools: row.defaultTools,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    setModelCategories(db, cloneId, categoryIdsFor(row, listCategories(db), membersByModel(db)));
    const cloned = db.select().from(modelConfigs).where(eq(modelConfigs.id, cloneId)).get()!;
    return { model: oneAdminModel(db, cloned) };
  });

  app.post("/api/admin/models/reorder", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const ids = (req.body as { ids?: string[] }).ids;
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ error: "Provide the model order." });
    const now = Date.now();
    ids.forEach((modelId, index) => {
      db.update(modelConfigs).set({ sortOrder: index, updatedAt: now }).where(eq(modelConfigs.id, modelId)).run();
    });
    const rows = db
      .select()
      .from(modelConfigs)
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
    return { models: mapAdminModels(db, rows.filter((row) => !row.missing)) };
  });

  app.delete("/api/admin/models/:id", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Model not found." });
    if (row.kind !== "custom") return reply.code(400).send({ error: "Installed Ollama models cannot be deleted here." });
    removeStoredIcon(uploadsDir, row.iconPath);
    db.delete(modelCategoryMembers).where(eq(modelCategoryMembers.modelId, id)).run();
    db.delete(modelConfigs).where(eq(modelConfigs.id, id)).run();
    return { ok: true };
  });

  app.get("/api/admin/categories", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    return { categories: listCategories(db) };
  });

  app.post("/api/admin/categories", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const name = String((req.body as { name?: string })?.name ?? "").trim();
    if (!name) return reply.code(400).send({ error: "Enter a category name." });
    const now = Date.now();
    const existing = listCategories(db);
    const row = {
      id: randomUUID(),
      name,
      sortOrder: existing.length,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(modelCategories).values(row).run();
    return { category: { id: row.id, name: row.name, sortOrder: row.sortOrder }, categories: listCategories(db) };
  });

  app.patch("/api/admin/categories/:id", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(modelCategories).where(eq(modelCategories.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Category not found." });
    const body = req.body as { name?: string; sortOrder?: number };
    const name = body.name?.trim();
    db.update(modelCategories)
      .set({
        name: name || row.name,
        sortOrder: body.sortOrder ?? row.sortOrder,
        updatedAt: Date.now(),
      })
      .where(eq(modelCategories.id, id))
      .run();
    return { categories: listCategories(db) };
  });

  app.post("/api/admin/categories/reorder", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const ids = (req.body as { ids?: string[] }).ids;
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ error: "Provide the category order." });
    const now = Date.now();
    ids.forEach((categoryId, index) => {
      db.update(modelCategories).set({ sortOrder: index, updatedAt: now }).where(eq(modelCategories.id, categoryId)).run();
    });
    return { categories: listCategories(db) };
  });

  app.delete("/api/admin/categories/:id", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(modelCategories).where(eq(modelCategories.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Category not found." });
    const affected = db.select().from(modelConfigs).where(eq(modelConfigs.categoryId, id)).all();
    db.delete(modelCategoryMembers).where(eq(modelCategoryMembers.categoryId, id)).run();
    for (const model of affected) {
      const remaining = db.select().from(modelCategoryMembers).where(eq(modelCategoryMembers.modelId, model.id)).all();
      db.update(modelConfigs)
        .set({ categoryId: remaining[0]?.categoryId ?? null, updatedAt: Date.now() })
        .where(eq(modelConfigs.id, model.id))
        .run();
    }
    db.delete(modelCategories).where(eq(modelCategories.id, id)).run();
    const rows = db
      .select()
      .from(modelConfigs)
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
    return { categories: listCategories(db), models: mapAdminModels(db, rows) };
  });

  app.patch("/api/admin/models/:id", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Model not found." });
    const body = req.body as {
      displayName?: string;
      description?: string;
      enabled?: boolean;
      sortOrder?: number;
      thinkingSupported?: boolean;
      visionSupported?: boolean;
      toolsSupported?: boolean;
      structuredOutputSupported?: boolean;
      categoryId?: string | null;
      categoryIds?: string[];
      systemPrompt?: string;
      baseModelId?: string;
      hidden?: boolean;
      isPublic?: boolean;
      isMain?: boolean;
      originalName?: string;
      generation?: unknown;
      defaultTools?: unknown;
    };
    let categoryIds: string[] | undefined;
    try {
      categoryIds = resolveCategoryIds(db, body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Category not found." });
    }
    let baseModelId = row.baseModelId;
    let runtime = {};
    if (row.kind === "custom" && body.baseModelId) {
      const base = db.select().from(modelConfigs).where(eq(modelConfigs.id, body.baseModelId)).get();
      if (!base || base.kind === "custom") return reply.code(400).send({ error: "Choose an installed Ollama model." });
      baseModelId = base.id;
      runtime = copyRuntime(base);
    }
    if (body.isMain) {
      db.update(modelConfigs).set({ isMain: 0 }).run();
    }
    db.update(modelConfigs)
      .set({
        displayName: body.displayName?.trim() || row.displayName,
        description: body.description ?? row.description,
        enabled: body.enabled == null ? row.enabled : body.enabled ? 1 : 0,
        sortOrder: body.sortOrder ?? row.sortOrder,
        thinkingSupported: body.thinkingSupported == null ? row.thinkingSupported : body.thinkingSupported ? 1 : 0,
        visionSupported: body.visionSupported == null ? row.visionSupported : body.visionSupported ? 1 : 0,
        toolsSupported: body.toolsSupported == null ? row.toolsSupported : body.toolsSupported ? 1 : 0,
        structuredOutputSupported:
          body.structuredOutputSupported == null ? row.structuredOutputSupported : body.structuredOutputSupported ? 1 : 0,
        systemPrompt: body.systemPrompt == null ? row.systemPrompt : body.systemPrompt,
        hidden: body.hidden == null ? row.hidden : body.hidden ? 1 : 0,
        isPublic: body.isPublic == null ? row.isPublic : body.isPublic ? 1 : 0,
        isMain: body.isMain == null ? row.isMain : body.isMain ? 1 : 0,
        remoteModel: body.originalName == null ? row.remoteModel : body.originalName.trim() || row.remoteModel,
        generationParams:
          body.generation == null ? row.generationParams : JSON.stringify(parseGenerationSettings(body.generation)),
        defaultTools: body.defaultTools == null ? row.defaultTools : storeDefaultTools(body.defaultTools),
        categoryId: categoryIds ? categoryIds[0] ?? null : row.categoryId,
        baseModelId,
        updatedAt: Date.now(),
        ...runtime,
      })
      .where(eq(modelConfigs.id, id))
      .run();
    if (categoryIds) setModelCategories(db, id, categoryIds);
    const next = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get()!;
    return { model: oneAdminModel(db, next) };
  });

  app.post("/api/admin/models/:id/icon", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Model not found." });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Choose an image to use as the logo." });
    try {
      const saved = await saveModelIcon(uploadsDir, file, row.iconPath);
      db.update(modelConfigs)
        .set({ iconPath: saved.name, iconType: saved.type, updatedAt: Date.now() })
        .where(eq(modelConfigs.id, id))
        .run();
      const next = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get()!;
      return { model: oneAdminModel(db, next) };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode ?? 400;
      return reply.code(status).send({
        error: error instanceof Error ? error.message : "Could not save the logo.",
      });
    }
  });

  app.delete("/api/admin/models/:id/icon", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Model not found." });
    removeStoredIcon(uploadsDir, row.iconPath);
    db.update(modelConfigs)
      .set({ iconPath: null, iconType: null, updatedAt: Date.now() })
      .where(eq(modelConfigs.id, id))
      .run();
    const next = db.select().from(modelConfigs).where(eq(modelConfigs.id, id)).get()!;
    return { model: oneAdminModel(db, next) };
  });

  app.get("/api/admin/ollama", async (req, reply) => {
    const user = await requireAdmin(req, reply, db);
    if (!user) return;
    const client = firstOllamaClient(loadConnections(db, env));
    if (!client) return { connected: false, version: null, models: 0 };
    try {
      const version = await client.version();
      const names = await client.tags();
      return { connected: true, version, models: names.length };
    } catch {
      return { connected: false, version: null, models: 0 };
    }
  });
}

export { toChatModel };
