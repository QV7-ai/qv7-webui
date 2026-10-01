import { useEffect, useRef, useState } from "react";
import { GripVertical, MoreHorizontal, Pencil, Search, X } from "lucide-react";
import { EMPTY_GENERATION, GENERATION_FIELDS, parseGenerationSettings, type GenerationSettings } from "@wlfv/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ModelIcon } from "@/components/models/ModelIcon";
import { fieldLabel } from "@/lib/i18n";
import { useT } from "@/lib/language";
import type { ChatModel, ModelCategory, ModelDefaults } from "@wlfv/shared";

export type AdminModel = ChatModel & {
  ollamaModel: string;
  originalName?: string;
  enabled: boolean;
  missing?: boolean;
  hidden?: boolean;
  isPublic?: boolean;
  isMain?: boolean;
  kind?: "installed" | "custom";
  providerKind?: "openai" | "ollama";
  systemPrompt?: string;
  baseModelId?: string;
  generation?: GenerationSettings;
};

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full ${checked ? "bg-[var(--accent)]" : "bg-[var(--surface)]"}`}
    >
      <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white" style={{ left: checked ? 18 : 2 }} />
    </button>
  );
}

export function ModelsPanel() {
  const tr = useT();
  const [models, setModels] = useState<AdminModel[]>([]);
  const [categories, setCategories] = useState<ModelCategory[]>([]);
  const [pending, setPending] = useState(true);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<AdminModel | null>(null);
  const [creating, setCreating] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuDraft, setMenuDraft] = useState<{ hidden: boolean; isMain: boolean; isPublic: boolean } | null>(null);
  const [menuSaving, setMenuSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [loadedIds, setLoadedIds] = useState<string[]>([]);
  const [unloadingId, setUnloadingId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragId = useRef<string | null>(null);
  const categoryDragId = useRef<string | null>(null);

  function apply(list: AdminModel[]) {
    setModels(list);
  }

  function replace(model: AdminModel) {
    setModels((current) => current.map((item) => (item.id === model.id ? model : item)));
    setEditing((current) => (current?.id === model.id ? model : current));
  }

  async function load(refresh = false) {
    setPending(true);
    setMessage("");
    try {
      const data = refresh ? await api.send("/api/admin/ollama/refresh", "POST") : await api.get("/api/admin/models");
      const list = (data.models ?? []) as AdminModel[];
      apply(list);
      setCategories((data.categories ?? []) as ModelCategory[]);
      if (!list.length) setMessage(tr("noModels"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tr("couldNotLoadModels"));
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshLoaded() {
      try {
        const data = await api.get("/api/models/loaded");
        if (!cancelled) setLoadedIds(Array.isArray(data.ids) ? data.ids : []);
      } catch {
        if (!cancelled) setLoadedIds([]);
      }
    }
    void refreshLoaded();
    const timer = window.setInterval(() => void refreshLoaded(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function unload(model: AdminModel) {
    setUnloadingId(model.id);
    setMessage("");
    try {
      const data = await api.send(`/api/admin/models/${model.id}/unload`, "POST");
      setLoadedIds(Array.isArray(data.ids) ? data.ids : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tr("couldNotUnload"));
    } finally {
      setUnloadingId(null);
    }
  }

  useEffect(() => {
    if (!menuId) return;
    const close = () => {
      setMenuId(null);
      setMenuDraft(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuId]);

  async function patch(model: AdminModel, body: Record<string, unknown>) {
    const data = await api.send(`/api/admin/models/${model.id}`, "PATCH", body);
    replace(data.model);
    if (body.isMain) {
      setModels((current) => current.map((item) => ({ ...item, isMain: item.id === model.id })));
    }
    return data.model as AdminModel;
  }

  async function reorder(ids: string[]) {
    const data = await api.send("/api/admin/models/reorder", "POST", { ids });
    if (data.models) apply(data.models);
  }

  async function reorderCategories(ids: string[]) {
    const data = await api.send("/api/admin/categories/reorder", "POST", { ids });
    if (data.categories) setCategories(data.categories as ModelCategory[]);
  }

  function categoryLabel(model: AdminModel) {
    const names = model.categoryNames?.length ? model.categoryNames : model.categoryName ? [model.categoryName] : [];
    return names.join(", ");
  }

  const bases = models.filter((item) => item.kind !== "custom");
  const needle = query.trim().toLowerCase();
  const visible = models.filter((model) => {
    if (model.missing) return false;
    if (!needle) return true;
    return [model.displayName, model.originalName, model.ollamaModel, model.id]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  return (
    <div>
      {editing || creating ? (
        <ModelEditor
          model={editing}
          bases={bases}
          categories={categories}
          onCategories={setCategories}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={(model) => {
            if (creating) setModels((current) => [model, ...current.filter((item) => item.id !== model.id)]);
            else replace(model);
            setEditing(null);
            setCreating(false);
          }}
          onUpload={
            editing
              ? async (file) => {
                  const data = await api.upload(`/api/admin/models/${editing.id}/icon`, file);
                  replace(data.model);
                }
              : undefined
          }
          onClearLogo={
            editing
              ? async () => {
                  const data = await api.send(`/api/admin/models/${editing.id}/icon`, "DELETE");
                  replace(data.model);
                }
              : undefined
          }
          onError={setMessage}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-medium">{tr("models")}</h1>
              <p className="mt-2 text-[13px] text-[var(--secondary)]">{tr("modelsHint")}</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setSearchOpen((open) => {
                    const next = !open;
                    if (!next) setQuery("");
                    else window.setTimeout(() => searchRef.current?.focus(), 0);
                    return next;
                  });
                }}
                aria-label={tr("searchModels")}
                aria-pressed={searchOpen}
              >
                <Search size={14} />
                {tr("search")}
              </Button>
              <Button onClick={() => setCreating(true)}>{tr("new")}</Button>
              <Button onClick={() => void load(true)} disabled={pending}>
                {pending ? tr("loading") : tr("refresh")}
              </Button>
            </div>
          </div>
          {searchOpen ? (
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tr("searchModels")}
              className="mt-4 h-9 w-full rounded-lg bg-[var(--surface)] px-3 text-[13px] outline-none"
            />
          ) : null}
          {message ? <p className="mt-4 text-[13px] text-[var(--danger)]">{message}</p> : null}
          {categories.length ? (
            <div className="mt-6">
              <h2 className="text-[15px] font-medium">{tr("modelCategories")}</h2>
              <p className="mt-1 text-[12px] text-[var(--muted)]">{tr("categoriesHint")}</p>
              <div className="mt-3 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] px-2">
                {categories.map((category) => (
                  <div
                    key={category.id}
                    draggable
                    onDragStart={() => {
                      categoryDragId.current = category.id;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      const from = categoryDragId.current;
                      categoryDragId.current = null;
                      if (!from || from === category.id) return;
                      const ids = categories.map((item) => item.id);
                      const fromIndex = ids.indexOf(from);
                      const toIndex = ids.indexOf(category.id);
                      if (fromIndex < 0 || toIndex < 0) return;
                      ids.splice(fromIndex, 1);
                      ids.splice(toIndex, 0, from);
                      setCategories(ids.map((id) => categories.find((item) => item.id === id)!).filter(Boolean));
                      void reorderCategories(ids).catch((error) =>
                        setMessage(error instanceof Error ? error.message : tr("couldNotReorder")),
                      );
                    }}
                    className="flex items-center gap-2 py-2.5"
                  >
                    <span className="cursor-grab text-[var(--muted)]" aria-hidden>
                      <GripVertical size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{category.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-6 divide-y divide-[var(--border)]">
            {visible.map((model) => (
              <div
                key={model.id}
                draggable={!needle}
                onDragStart={() => {
                  if (needle) return;
                  dragId.current = model.id;
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  const from = dragId.current;
                  dragId.current = null;
                  if (!from || from === model.id) return;
                  const ids = models.map((item) => item.id);
                  const fromIndex = ids.indexOf(from);
                  const toIndex = ids.indexOf(model.id);
                  if (fromIndex < 0 || toIndex < 0) return;
                  ids.splice(fromIndex, 1);
                  ids.splice(toIndex, 0, from);
                  setModels(ids.map((id) => models.find((item) => item.id === id)!).filter(Boolean));
                  void reorder(ids).catch((error) => setMessage(error instanceof Error ? error.message : tr("couldNotReorder")));
                }}
                className={`flex items-center gap-2 py-3 ${model.hidden ? "opacity-50" : ""}`}
              >
                <span className="cursor-grab text-[var(--muted)]" aria-hidden>
                  <GripVertical size={14} />
                </span>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setEditing(model)}>
                  <span className="relative shrink-0">
                    <ModelIcon name={model.displayName} iconUrl={model.iconUrl} size={40} />
                    {loadedIds.includes(model.id) ? (
                      <span
                        className="absolute rounded-full bg-[#22c55e]"
                        style={{ width: 9, height: 9, right: -1, bottom: -1, boxShadow: "0 0 0 2px var(--bg)" }}
                        title={tr("loadedInOllama")}
                        aria-label={tr("loadedInOllama")}
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[14px]">
                      <span className="truncate">{model.displayName}</span>
                      {model.isMain ? <span className="text-[11px] text-[var(--accent)]">{tr("main")}</span> : null}
                      {!model.isPublic ? <span className="text-[11px] text-[var(--muted)]">{tr("private")}</span> : null}
                      {model.capabilities.thinking ? (
                        <span className="rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted)]">{tr("thinking")}</span>
                      ) : null}
                      {model.capabilities.thinkingLevels.length ? (
                        <span className="rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted)]">{tr("reasoning")}</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--muted)]">
                      {categoryLabel(model) ? `${categoryLabel(model)} · ` : ""}
                      {model.originalName || model.ollamaModel}
                    </span>
                  </span>
                </button>
                {model.providerKind !== "openai" && loadedIds.includes(model.id) ? (
                  <Button
                    size="sm"
                    disabled={unloadingId === model.id}
                    onClick={() => void unload(model)}
                    aria-label={`Unload ${model.displayName}`}
                  >
                    {unloadingId === model.id ? tr("unloading") : tr("unload")}
                  </Button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  aria-label={`Edit ${model.displayName}`}
                  onClick={() => setEditing(model)}
                >
                  <Pencil size={14} />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                    aria-label={`More for ${model.displayName}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuId((current) => {
                        if (current === model.id) {
                          setMenuDraft(null);
                          return null;
                        }
                        setMenuDraft({
                          hidden: Boolean(model.hidden),
                          isMain: Boolean(model.isMain),
                          isPublic: model.isPublic !== false,
                        });
                        return model.id;
                      });
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {menuId === model.id && menuDraft ? (
                    <div
                      className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-[var(--border)] bg-[var(--elevated)] py-1 shadow-2xl"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MenuItem
                        label={tr("hideModel")}
                        active={menuDraft.hidden}
                        onClick={() => setMenuDraft((current) => current && { ...current, hidden: !current.hidden, isMain: current.hidden ? current.isMain : false })}
                      />
                      <MenuItem
                        label={tr("setMainModel")}
                        active={menuDraft.isMain}
                        onClick={() =>
                          setMenuDraft((current) => current && { ...current, isMain: !current.isMain, hidden: !current.isMain ? false : current.hidden })
                        }
                      />
                      <MenuItem
                        label={tr("setPublicModel")}
                        active={menuDraft.isPublic}
                        onClick={() => setMenuDraft((current) => current && { ...current, isPublic: !current.isPublic })}
                      />
                      {model.kind === "custom" ? (
                        <MenuItem
                          label={tr("cloneModel")}
                          onClick={() => {
                            setMenuId(null);
                            setMenuDraft(null);
                            void api
                              .send(`/api/admin/models/${model.id}/clone`, "POST")
                              .then((data) => setModels((current) => [data.model, ...current]))
                              .catch((error) => setMessage(error instanceof Error ? error.message : tr("couldNotClone")));
                          }}
                        />
                      ) : null}
                      {model.providerKind !== "openai" && loadedIds.includes(model.id) ? (
                        <MenuItem
                          label={unloadingId === model.id ? tr("unloading") : tr("unloadFromOllama")}
                          onClick={() => {
                            setMenuId(null);
                            setMenuDraft(null);
                            void unload(model);
                          }}
                        />
                      ) : null}
                      <div className="mt-1 border-t border-[var(--border)] px-2 py-1.5">
                        <Button
                          variant="primary"
                          className="w-full"
                          disabled={menuSaving}
                          onClick={() => {
                            setMenuSaving(true);
                            void patch(model, {
                              hidden: menuDraft.isMain ? false : menuDraft.hidden,
                              isMain: menuDraft.isMain,
                              isPublic: menuDraft.isPublic,
                              ...(menuDraft.isMain ? { enabled: true } : {}),
                            })
                              .then(() => {
                                setMenuId(null);
                                setMenuDraft(null);
                              })
                              .catch((error) => setMessage(error instanceof Error ? error.message : tr("couldNotUpdate")))
                              .finally(() => setMenuSaving(false));
                          }}
                        >
                          {menuSaving ? tr("saving") : tr("save")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <Switch
                  checked={model.enabled}
                  label={`Enable ${model.displayName}`}
                  onChange={() =>
                    void patch(model, { enabled: !model.enabled }).catch((error) =>
                      setMessage(error instanceof Error ? error.message : tr("couldNotUpdate")),
                    )
                  }
                />
              </div>
            ))}
            {!pending && !visible.length ? (
              <p className="py-6 text-[13px] text-[var(--muted)]">
                {needle ? tr("noModelsMatch") : tr("noModels")}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]" onClick={onClick}>
      {label}
      {active ? <span className="text-[11px] text-[var(--accent)]">On</span> : null}
    </button>
  );
}

function ModelEditor({
  model,
  bases,
  categories,
  onCategories,
  onClose,
  onSaved,
  onUpload,
  onClearLogo,
  onError,
}: {
  model: AdminModel | null;
  bases: AdminModel[];
  categories: ModelCategory[];
  onCategories: (categories: ModelCategory[]) => void;
  onClose: () => void;
  onSaved: (model: AdminModel) => void;
  onUpload?: (file: File) => Promise<void>;
  onClearLogo?: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const tr = useT();
  const creating = !model;
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(model?.displayName || "");
  const [originalName, setOriginalName] = useState(model?.originalName || model?.ollamaModel || "");
  const [baseModelId, setBaseModelId] = useState(model?.baseModelId || "");
  const [categoryIds, setCategoryIds] = useState<string[]>(
    model?.categoryIds?.length ? model.categoryIds : model?.categoryId ? [model.categoryId] : [],
  );
  const [newCategory, setNewCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [isPublic, setIsPublic] = useState(model ? model.isPublic !== false : true);
  const [systemPrompt, setSystemPrompt] = useState(model?.systemPrompt || "");
  const [generation, setGeneration] = useState<GenerationSettings>(
    model?.generation ? { ...model.generation, show: true } : { ...EMPTY_GENERATION, values: {}, custom: [] },
  );
  const [thinking, setThinking] = useState(model?.capabilities.thinking ?? false);
  const [vision, setVision] = useState(model?.capabilities.vision ?? false);
  const [tools, setTools] = useState(model?.capabilities.tools ?? false);
  const [structured, setStructured] = useState(model?.capabilities.structuredOutput ?? false);
  const [defaultTools, setDefaultTools] = useState<ModelDefaults>({
    thinking: Boolean(model?.defaults?.thinking),
    thinkingLevel: model?.defaults?.thinkingLevel || "",
    webSearch: Boolean(model?.defaults?.webSearch),
    codeInterpreter: Boolean(model?.defaults?.codeInterpreter),
  });
  const [pendingIcon, setPendingIcon] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState(model?.iconUrl);
  const [saving, setSaving] = useState(false);
  const inputClass = "mt-1 h-9 w-full rounded-lg bg-[var(--surface)] px-3 text-[13px] outline-none";

  useEffect(() => {
    setName(model?.displayName || "");
    setOriginalName(model?.originalName || model?.ollamaModel || "");
    setBaseModelId(model?.baseModelId || "");
    setCategoryIds(model?.categoryIds?.length ? model.categoryIds : model?.categoryId ? [model.categoryId] : []);
    setNewCategory("");
    setIsPublic(model ? model.isPublic !== false : true);
    setSystemPrompt(model?.systemPrompt || "");
    setGeneration(model?.generation ? { ...parseGenerationSettings(model.generation), show: true } : { ...EMPTY_GENERATION, values: {}, custom: [] });
    setThinking(model?.capabilities.thinking ?? false);
    setVision(model?.capabilities.vision ?? false);
    setTools(model?.capabilities.tools ?? false);
    setStructured(model?.capabilities.structuredOutput ?? false);
    setDefaultTools({
      thinking: Boolean(model?.defaults?.thinking),
      thinkingLevel: model?.defaults?.thinkingLevel || "",
      webSearch: Boolean(model?.defaults?.webSearch),
      codeInterpreter: Boolean(model?.defaults?.codeInterpreter),
    });
    setPendingIcon(null);
    setPreviewUrl(model?.iconUrl);
  }, [model]);

  useEffect(() => {
    if (!pendingIcon) return;
    const url = URL.createObjectURL(pendingIcon);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingIcon]);

  function applyBase(id: string) {
    setBaseModelId(id);
    const base = bases.find((item) => item.id === id);
    if (!base) return;
    setOriginalName(base.originalName || base.ollamaModel);
    setThinking(base.capabilities.thinking);
    setVision(base.capabilities.vision);
    setTools(base.capabilities.tools);
    setStructured(base.capabilities.structuredOutput);
    if (base.generation) setGeneration({ ...parseGenerationSettings(base.generation), show: true });
  }

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    setAddingCategory(true);
    onError("");
    try {
      const data = await api.send("/api/admin/categories", "POST", { name });
      onCategories((data.categories ?? []) as ModelCategory[]);
      if (data.category?.id) {
        setCategoryIds((current) => (current.includes(data.category.id) ? current : [...current, data.category.id]));
      }
      setNewCategory("");
    } catch (error) {
      onError(error instanceof Error ? error.message : tr("couldNotAddCategory"));
    } finally {
      setAddingCategory(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      onError(tr("enterModelName"));
      return;
    }
    if (creating && !baseModelId) {
      onError(tr("chooseOriginalModel"));
      return;
    }
    setSaving(true);
    onError("");
    try {
      const payload = {
        displayName: name.trim(),
        originalName,
        categoryIds,
        isPublic,
        systemPrompt,
        generation,
        thinkingSupported: thinking,
        visionSupported: vision,
        toolsSupported: tools,
        structuredOutputSupported: structured,
        defaultTools,
        ...(creating ? { baseModelId } : {}),
      };
      const data = creating
        ? await api.send("/api/admin/models", "POST", payload)
        : await api.send(`/api/admin/models/${model.id}`, "PATCH", payload);
      let next = data.model as AdminModel;
      const icon = pendingIcon;
      if (icon) {
        const uploaded = await api.upload(`/api/admin/models/${next.id}/icon`, icon);
        next = uploaded.model;
      }
      onSaved(next);
    } catch (error) {
      onError(error instanceof Error ? error.message : creating ? tr("couldNotCreateModel") : tr("couldNotSaveModel"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button type="button" className="text-[13px] text-[var(--muted)] hover:text-[var(--text)]" onClick={onClose}>
          ← {tr("models")}
        </button>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? tr("saving") : tr("save")}
        </Button>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <button type="button" className="rounded-lg" onClick={() => fileRef.current?.click()} aria-label={tr("uploadModelImage")}>
            <ModelIcon name={name} iconUrl={previewUrl} size={72} />
          </button>
          {previewUrl ? (
            <button
              type="button"
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--elevated)] text-[var(--muted)]"
              onClick={() => {
                setPendingIcon(null);
                setPreviewUrl(undefined);
                if (onClearLogo) void onClearLogo();
              }}
              aria-label={tr("removeImage")}
            >
              <X size={12} />
            </button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (onUpload) void onUpload(file);
              else setPendingIcon(file);
            }}
          />
        </div>
        <p className="text-[12px] text-[var(--muted)]">{tr("clickUploadIcon")}</p>
      </div>
      <label className="mt-5 block text-[12px] text-[var(--muted)]">
        {tr("modelName")}
        <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="mt-3 block text-[12px] text-[var(--muted)]">
        {tr("originalModelName")}
        {creating ? (
          <select className={inputClass} value={baseModelId} onChange={(event) => applyBase(event.target.value)}>
            <option value="">{tr("selectAModel")}</option>
            {bases.map((base) => (
              <option key={base.id} value={base.id}>
                {base.originalName || base.ollamaModel}
              </option>
            ))}
          </select>
        ) : (
          <input className={inputClass} value={originalName} onChange={(event) => setOriginalName(event.target.value)} />
        )}
      </label>
      <div className="mt-3">
        <span className="block text-[12px] text-[var(--muted)]">{tr("modelCategories")}</span>
        <div className="mt-1 space-y-1 rounded-lg bg-[var(--surface)] px-3 py-2">
          {categories.length ? (
            categories.map((category) => {
              const checked = categoryIds.includes(category.id);
              return (
                <label key={category.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setCategoryIds((current) =>
                        current.includes(category.id)
                          ? current.filter((id) => id !== category.id)
                          : [...current, category.id],
                      )
                    }
                  />
                  {category.name}
                </label>
              );
            })
          ) : (
            <p className="text-[13px] text-[var(--muted)]">{tr("uncategorized")}</p>
          )}
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className={inputClass + " mt-0"}
          value={newCategory}
          placeholder={tr("newCategoryName")}
          onChange={(event) => setNewCategory(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void addCategory();
          }}
        />
        <Button disabled={addingCategory || !newCategory.trim()} onClick={() => void addCategory()}>
          {addingCategory ? "Adding…" : "Add"}
        </Button>
      </div>
      <div className="mt-4 flex items-center justify-between py-2">
        <span>
          <span className="block text-[14px]">{tr("publicModel")}</span>
          <span className="text-[12px] text-[var(--muted)]">Visible to all users when enabled.</span>
        </span>
        <Switch checked={isPublic} onChange={setIsPublic} label={tr("publicModel")} />
      </div>
      <label className="mt-3 block text-[12px] text-[var(--muted)]">
        {tr("systemPrompt")}
        <textarea
          className="mt-1 min-h-[96px] w-full rounded-lg bg-[var(--surface)] px-3 py-2 text-[13px] outline-none"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
        />
      </label>
      <h3 className="mt-6 text-[15px] font-medium">Advanced Parameters</h3>
      <div className="mt-2">
        {GENERATION_FIELDS.map((field) => {
          const current = generation.values[field.key] ?? "";
          return (
            <label key={field.key} className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2">
              <span className="min-w-0 text-[12px]">{fieldLabel("en", field.key)}</span>
              {field.kind === "boolean" || field.kind === "select" ? (
                <select
                  className="h-8 w-40 rounded-lg bg-[var(--surface)] px-2 text-[12px]"
                  value={current}
                  onChange={(event) => setGeneration({ ...generation, values: { ...generation.values, [field.key]: event.target.value } })}
                >
                  <option value="">Default</option>
                  {(field.options || ["true", "false"]).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="h-8 w-40 rounded-lg bg-[var(--surface)] px-2 text-[12px]"
                  value={current}
                  placeholder="Default"
                  onChange={(event) => setGeneration({ ...generation, values: { ...generation.values, [field.key]: event.target.value } })}
                />
              )}
            </label>
          );
        })}
      </div>
      <h3 className="mt-6 text-[15px] font-medium">{tr("defaultTools")}</h3>
      <p className="mt-1 text-[12px] text-[var(--muted)]">{tr("defaultToolsHint")}</p>
      <div className="mt-2">
        <div className="flex items-center justify-between border-b border-[var(--border)] py-2">
          <span className="text-[13px]">{tr("thinking")}</span>
          <Switch
            checked={Boolean(defaultTools.thinking)}
            onChange={(value) => setDefaultTools((current) => ({ ...current, thinking: value }))}
            label={tr("thinking")}
          />
        </div>
        {(model?.capabilities.thinkingLevels.length ?? 0) > 0 ? (
          <label className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2 text-[13px]">
            <span>{tr("reasoningEffort")}</span>
            <select
              className="h-8 w-40 rounded-lg bg-[var(--surface)] px-2 text-[12px]"
              value={defaultTools.thinkingLevel || model?.capabilities.thinkingLevels[0] || ""}
              onChange={(event) => setDefaultTools((current) => ({ ...current, thinking: true, thinkingLevel: event.target.value }))}
            >
              {model?.capabilities.thinkingLevels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex items-center justify-between border-b border-[var(--border)] py-2">
          <span className="text-[13px]">{tr("webSearchChip")}</span>
          <Switch
            checked={Boolean(defaultTools.webSearch)}
            onChange={(value) => setDefaultTools((current) => ({ ...current, webSearch: value }))}
            label={tr("webSearchChip")}
          />
        </div>
        <div className="flex items-center justify-between border-b border-[var(--border)] py-2">
          <span className="text-[13px]">{tr("codeInterpreter")}</span>
          <Switch
            checked={Boolean(defaultTools.codeInterpreter)}
            onChange={(value) => setDefaultTools((current) => ({ ...current, codeInterpreter: value }))}
            label={tr("codeInterpreter")}
          />
        </div>
      </div>
      <h3 className="mt-6 text-[15px] font-medium">Capabilities</h3>
      <div className="mt-2">
        {[
          { label: "Thinking", value: thinking, set: setThinking },
          { label: tr("vision"), value: vision, set: setVision },
          { label: tr("tools"), value: tools, set: setTools },
          { label: tr("structuredOutput"), value: structured, set: setStructured },
        ].map((item) => (
          <div key={item.label} className="flex items-center justify-between border-b border-[var(--border)] py-2">
            <span className="text-[13px]">{item.label}</span>
            <Switch checked={item.value} onChange={item.set} label={item.label} />
          </div>
        ))}
      </div>
      <div className="mt-6">
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? tr("saving") : tr("save")}
        </Button>
      </div>
    </div>
  );
}
