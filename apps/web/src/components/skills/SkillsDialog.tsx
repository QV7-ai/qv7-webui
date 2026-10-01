import { useRef, useState } from "react";
import { Plus, Search, Sparkles } from "lucide-react";
import type { UserSkill } from "@wlfv/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useT } from "@/lib/language";

const PAGE = 8;

export function SkillsPage({
  skills,
  username,
  onChange,
  onDefault,
}: {
  skills: UserSkill[];
  username: string;
  onChange: (skills: UserSkill[]) => void;
  onDefault: (skill: UserSkill) => void;
}) {
  const tr = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"mine" | "shared">("mine");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const [visible, setVisible] = useState(PAGE);
  const [editing, setEditing] = useState<UserSkill | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<UserSkill | null>(null);

  function startNew() {
    setEditing(null);
    setCreating(true);
    setName("");
    setContent("");
    setError("");
  }

  function startEdit(skill: UserSkill) {
    setCreating(false);
    setEditing(skill);
    setName(skill.name);
    setContent(skill.content);
    setError("");
  }

  function cancelForm() {
    setEditing(null);
    setCreating(false);
    setName("");
    setContent("");
    setError("");
  }

  async function save() {
    const nextName = name.trim();
    const nextContent = content.trim();
    if (!nextName || !nextContent) {
      setError(tr("skillRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) {
        const data = await api.send(`/api/skills/${editing.id}`, "PATCH", { name: nextName, content: nextContent });
        onChange(skills.map((skill) => (skill.id === editing.id ? data.skill : skill)));
      } else {
        const data = await api.send("/api/skills", "POST", { name: nextName, content: nextContent });
        onChange([...skills, data.skill].sort((a, b) => a.name.localeCompare(b.name)));
      }
      cancelForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("couldNotSaveSkill"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(skill: UserSkill) {
    setError("");
    try {
      await api.send(`/api/skills/${skill.id}`, "DELETE");
      onChange(skills.filter((item) => item.id !== skill.id));
      if (editing?.id === skill.id) cancelForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("couldNotDeleteSkill"));
    }
  }

  async function toggleDefault(skill: UserSkill) {
    const next = !skill.defaultOn;
    try {
      const data = await api.send(`/api/skills/${skill.id}`, "PATCH", { defaultOn: next });
      onChange(skills.map((item) => (item.id === skill.id ? data.skill : item)));
      onDefault(data.skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("couldNotSaveSkill"));
    }
  }

  async function importFile(file: File) {
    const text = await file.text();
    const incoming: { name: string; content: string }[] = [];
    try {
      const parsed = JSON.parse(text) as { name?: string; content?: string; skills?: { name?: string; content?: string }[] };
      const rows = Array.isArray(parsed.skills) ? parsed.skills : [parsed];
      for (const row of rows) {
        const skillName = String(row.name || "").trim();
        const skillContent = String(row.content || "").trim();
        if (skillName && skillContent) incoming.push({ name: skillName, content: skillContent });
      }
    } catch {
      const skillName = file.name.replace(/\.[^.]+$/, "").trim();
      const skillContent = text.trim();
      if (skillName && skillContent) incoming.push({ name: skillName, content: skillContent });
    }
    if (!incoming.length) {
      setError(tr("skillRequired"));
      return;
    }
    const created: UserSkill[] = [];
    for (const row of incoming) {
      const data = await api.send("/api/skills", "POST", row);
      created.push(data.skill);
    }
    onChange([...skills, ...created].sort((a, b) => a.name.localeCompare(b.name)));
  }

  const q = query.trim().toLowerCase();
  const mine = skills.filter((skill) => {
    if (filter === "on" && !skill.defaultOn) return false;
    if (filter === "off" && skill.defaultOn) return false;
    if (!q) return true;
    return skill.name.toLowerCase().includes(q) || skill.content.toLowerCase().includes(q);
  });
  const shown = mine.slice(0, visible);
  const formOpen = creating || Boolean(editing);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight">{tr("skills")}</h1>
            <p className="mt-1 max-w-xl text-[13px] text-[var(--muted)]">{tr("skillsHint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-9 rounded-full bg-[var(--surface)] px-4 text-[13px] hover:bg-[var(--hover)]"
              onClick={() => fileRef.current?.click()}
            >
              {tr("importSkill")}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-full bg-[var(--text)] px-4 text-[13px] font-medium text-[var(--bg)]"
              onClick={startNew}
            >
              <Plus size={14} />
              {tr("newSkill")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.md,.txt,application/json,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-[13px] ${tab === "mine" ? "bg-[var(--surface)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            onClick={() => setTab("mine")}
          >
            {tr("mySkills")}
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-[13px] ${tab === "shared" ? "bg-[var(--surface)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            onClick={() => setTab("shared")}
          >
            {tr("sharedSkills")}
          </button>
        </div>

        {tab === "shared" ? (
          <p className="mt-8 text-[13px] text-[var(--muted)]">{tr("noSharedSkills")}</p>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-2">
              <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg bg-[var(--surface)] px-3">
                <Search size={15} className="shrink-0 text-[var(--muted)]" />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setVisible(PAGE);
                  }}
                  placeholder={tr("searchForSkills")}
                  aria-label={tr("searchForSkills")}
                  className="h-full w-full bg-transparent text-[14px] outline-none placeholder:text-[var(--muted)]"
                />
              </label>
              <select
                value={filter}
                aria-label={tr("allSkills")}
                onChange={(event) => {
                  setFilter(event.target.value as "all" | "on" | "off");
                  setVisible(PAGE);
                }}
                className="h-10 rounded-lg bg-[var(--surface)] px-3 text-[13px] outline-none"
              >
                <option value="all">{tr("allSkills")}</option>
                <option value="on">{tr("skillsOn")}</option>
                <option value="off">{tr("skillsOff")}</option>
              </select>
            </div>

            {formOpen ? (
              <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-[14px] font-medium">{editing ? tr("editSkill") : tr("newSkill")}</p>
                <label className="mt-3 block text-[12px] text-[var(--muted)]">
                  {tr("skillName")}
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1 h-9 w-full rounded-lg bg-[var(--bg)] px-3 text-[13px] text-[var(--text)] outline-none"
                  />
                </label>
                <label className="mt-3 block text-[12px] text-[var(--muted)]">
                  {tr("skillInstructions")}
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    className="mt-1 min-h-[120px] w-full rounded-lg bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
                  />
                </label>
                {error ? <p className="mt-2 text-[12px] text-[var(--danger)]">{error}</p> : null}
                <div className="mt-3 flex gap-2">
                  <Button variant="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? tr("saving") : tr("save")}
                  </Button>
                  {editing ? (
                    <Button variant="danger" onClick={() => setPendingDelete(editing)}>
                      {tr("deleteSkill")}
                    </Button>
                  ) : null}
                  <Button onClick={cancelForm}>{tr("cancel")}</Button>
                </div>
              </div>
            ) : error ? (
              <p className="mt-3 text-[12px] text-[var(--danger)]">{error}</p>
            ) : null}

            {mine.length ? (
              <div className="mt-6">
                <p className="text-[13px] text-[var(--muted)]">
                  {tr("createdBy", { name: username })} <span className="text-[var(--secondary)]">{mine.length}</span>
                </p>
                <ul className="mt-2">
                  {shown.map((skill) => (
                    <li key={skill.id} className="flex items-center gap-3 border-b border-[var(--border)] py-3">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => startEdit(skill)}>
                        <Sparkles size={16} className="shrink-0 text-[var(--muted)]" />
                        <span className="min-w-0 truncate text-[14px]">
                          <span className="font-medium">{skill.name}</span>
                          <span className="ml-2 text-[var(--muted)]">{skill.content}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={skill.defaultOn}
                        aria-label={tr("skillDefault")}
                        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${skill.defaultOn ? "bg-[#3dcc6d]" : "bg-[var(--hover)]"}`}
                        onClick={() => void toggleDefault(skill)}
                      >
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${skill.defaultOn ? "left-[22px]" : "left-0.5"}`} />
                      </button>
                    </li>
                  ))}
                </ul>
                {mine.length > shown.length ? (
                  <button type="button" className="mt-4 text-[14px] hover:underline" onClick={() => setVisible((count) => count + PAGE)}>
                    {tr("loadMore")}
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="mt-8 text-[13px] text-[var(--muted)]">{q || filter !== "all" ? tr("noSkillMatches") : tr("noSkills")}</p>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={tr("deleteSkillTitle")}
        description={tr("deleteSkillBody", { name: pendingDelete?.name || "" })}
        confirmLabel={tr("deleteSkill")}
        cancelLabel={tr("cancel")}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const skill = pendingDelete;
          setPendingDelete(null);
          if (skill) void remove(skill);
        }}
      />
    </div>
  );
}
