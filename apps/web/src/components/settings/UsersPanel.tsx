import { useEffect, useState, type FormEvent } from "react";
import { Search, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { UsagePanel } from "@/components/settings/UsagePanel";
import { useLang, useT } from "@/lib/language";

type ManagedUser = {
  id: string;
  email: string;
  username: string;
  role: string;
  plan?: string;
};

type PlanUsage = {
  id: string;
  email: string;
  username: string;
  role: string;
  plan: "free" | "pro";
  usedDay: number;
  usedWeek: number;
  dayLimit: number;
  weekLimit: number;
  lifetimeTokens: number;
  usageResetAt: number;
};

function compact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}m`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

export function UsersPanel({ currentUserId }: { currentUserId?: string }) {
  const tr = useT();
  const { lang } = useLang();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usage, setUsage] = useState<PlanUsage[]>([]);
  const [viewing, setViewing] = useState<PlanUsage | null>(null);
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [plan, setPlan] = useState("free");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  async function load() {
    try {
      const [people, usageData] = await Promise.all([api.get("/api/admin/users"), api.get("/api/admin/usage")]);
      setUsers(people.users ?? []);
      setUsage(usageData.users ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("couldNotLoadUsers"));
    }
  }

  async function resetUsageFor(row: PlanUsage) {
    setResettingId(row.id);
    setError("");
    try {
      const data = await api.send(`/api/admin/users/${row.id}/usage/reset`, "POST");
      if (data.user) {
        setUsage((current) => current.map((item) => (item.id === row.id ? data.user : item)));
        setViewing((current) => (current?.id === row.id ? { ...current, ...data.user } : current));
      }
      setConfirmResetId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("couldNotResetUsage"));
    } finally {
      setResettingId(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = await api.send("/api/admin/users", "POST", { username, email, password, role, plan });
      setUsers((current) => [...current, data.user]);
      const usageData = await api.get("/api/admin/usage");
      setUsage(usageData.users ?? []);
      setUsername("");
      setEmail("");
      setPassword("");
      setRole("user");
      setPlan("free");
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("couldNotAddUser"));
    } finally {
      setSaving(false);
    }
  }

  async function save(user: ManagedUser, patch: Partial<ManagedUser> & { password?: string }) {
    setError("");
    try {
      const data = await api.send(`/api/admin/users/${user.id}`, "PATCH", patch);
      setUsers((current) => current.map((item) => (item.id === user.id ? data.user : item)));
      const usageData = await api.get("/api/admin/usage");
      setUsage(usageData.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("couldNotUpdateUser"));
    }
  }

  async function remove(user: ManagedUser) {
    setError("");
    try {
      await api.send(`/api/admin/users/${user.id}`, "DELETE");
      setUsers((current) => current.filter((item) => item.id !== user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("couldNotRemoveUser"));
    }
  }

  const needle = query.trim().toLowerCase();
  const matches = (username: string, email: string) =>
    !needle || username.toLowerCase().includes(needle) || email.toLowerCase().includes(needle);
  const visibleUsers = users.filter((user) => matches(user.username, user.email));
  const visibleUsage = usage.filter((row) => matches(row.username, row.email));

  return (
    <div>
      <h2 className="text-[22px] font-medium">{tr("users")}</h2>
      <p className="mt-2 text-[13px] text-[var(--secondary)]">{tr("usersHint")}</p>
      {error ? <p className="mt-3 text-[13px] text-[var(--danger)]">{error}</p> : null}
      <form className="mt-6 grid gap-2 sm:grid-cols-2" onSubmit={(event) => void create(event)}>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={tr("accountName")}
          className="h-9 rounded-lg bg-[var(--surface)] px-3 text-[13px] outline-none"
        />
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={tr("email")}
          className="h-9 rounded-lg bg-[var(--surface)] px-3 text-[13px] outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={tr("password")}
          className="h-9 rounded-lg bg-[var(--surface)] px-3 text-[13px] outline-none"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="h-9 rounded-lg bg-[var(--surface)] px-3 text-[13px] outline-none"
        >
          <option value="pending">{tr("rolePending")}</option>
          <option value="user">{tr("roleUser")}</option>
          <option value="admin">{tr("roleAdmin")}</option>
        </select>
        <select
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          className="h-9 rounded-lg bg-[var(--surface)] px-3 text-[13px] outline-none"
        >
          <option value="free">{tr("planFree")}</option>
          <option value="pro">{tr("planPro")}</option>
        </select>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? tr("adding") : tr("addUser")}
          </Button>
        </div>
      </form>
      <label className="relative mt-8 block">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr("searchUsers")}
          aria-label={tr("searchUsers")}
          className="h-10 w-full rounded-lg bg-[var(--surface)] pl-8 pr-3 text-[14px] text-[var(--text)] outline-none md:h-9 md:text-[13px]"
        />
      </label>
      <div className="mt-2 divide-y divide-[var(--border)]">
        {visibleUsers.length === 0 ? <p className="py-3 text-[13px] text-[var(--muted)]">{tr("noUserMatches")}</p> : null}
        {visibleUsers.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            isSelf={user.id === currentUserId}
            onSave={save}
            onDelete={() => void remove(user)}
          />
        ))}
      </div>
      <h2 className="mt-10 text-[22px] font-medium">{tr("planUsage")}</h2>
      <p className="mt-2 text-[13px] text-[var(--secondary)]">{tr("planUsageHint")}</p>
      <div className="mt-4 divide-y divide-[var(--border)]">
        {visibleUsage.length === 0 ? <p className="py-3 text-[13px] text-[var(--muted)]">{needle ? tr("noUserMatches") : tr("noPlanUsers")}</p> : null}
        {visibleUsage.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px]">
                {row.username}
                <span className="ml-2 text-[11px] text-[var(--muted)]">{row.plan === "pro" ? tr("planPro") : tr("planFree")}</span>
              </p>
              <p className="truncate text-[12px] text-[var(--muted)]">
                {tr("tokensLast24h")} {compact(row.usedDay)}
                {row.dayLimit > 0 ? ` / ${compact(row.dayLimit)}` : ""}
                {" · "}
                {tr("tokensLast7d")} {compact(row.usedWeek)}
                {row.weekLimit > 0 ? ` / ${compact(row.weekLimit)}` : ""}
                {" · "}
                {compact(row.lifetimeTokens)}
              </p>
            </div>
            <Button onClick={() => setViewing(row)}>{tr("viewUsage")}</Button>
            <Button
              disabled={resettingId === row.id}
              onClick={() => {
                if (confirmResetId === row.id) void resetUsageFor(row);
                else setConfirmResetId(row.id);
              }}
            >
              {resettingId === row.id ? tr("working") : confirmResetId === row.id ? tr("confirmResetUsage") : tr("resetUsage")}
            </Button>
          </div>
        ))}
      </div>
      {viewing ? (
        <div className="motion-fade fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 md:items-center md:p-6">
          <div className="motion-pop max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-[var(--bg)] p-5 md:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[18px] font-medium">{viewing.username}</h3>
                <p className="mt-1 text-[12px] text-[var(--muted)]">{tr("resetUsageHint")}</p>
              </div>
              <button type="button" className="rounded-md p-1 text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setViewing(null)} aria-label={tr("close")}>
                <X size={16} />
              </button>
            </div>
            <UsagePanel key={`${viewing.id}-${viewing.usageResetAt}`} language={lang} userId={viewing.id} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  onSave,
  onDelete,
}: {
  user: ManagedUser;
  isSelf: boolean;
  onSave: (user: ManagedUser, patch: Partial<ManagedUser> & { password?: string }) => Promise<void>;
  onDelete: () => void;
}) {
  const tr = useT();
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user.role);
  const [plan, setPlan] = useState(user.plan || "free");

  useEffect(() => {
    setUsername(user.username);
    setEmail(user.email);
    setRole(user.role);
    setPlan(user.plan || "free");
  }, [user.email, user.plan, user.role, user.username]);

  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="text-[12px] text-[var(--muted)]">
        {tr("accountName")}
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="mt-1 h-8 w-full rounded-md bg-[var(--surface)] px-2 text-[13px] text-[var(--text)] outline-none"
        />
      </label>
      <label className="text-[12px] text-[var(--muted)]">
        {tr("email")}
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 h-8 w-full rounded-md bg-[var(--surface)] px-2 text-[13px] text-[var(--text)] outline-none"
        />
      </label>
      <div className="flex items-center gap-2">
        <select
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          className="h-8 rounded-md bg-[var(--surface)] px-2 text-[12px] outline-none"
        >
          <option value="free">{tr("planFree")}</option>
          <option value="pro">{tr("planPro")}</option>
        </select>
        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="h-8 rounded-md bg-[var(--surface)] px-2 text-[12px] outline-none"
        >
          <option value="pending">{tr("rolePending")}</option>
          <option value="user">{tr("roleUser")}</option>
          <option value="admin">{tr("roleAdmin")}</option>
        </select>
        {!isSelf ? (
          <button type="button" className="rounded-md p-1.5 text-[var(--muted)] hover:text-[var(--danger)]" onClick={onDelete} aria-label={tr("removeUser")}>
            <Trash2 size={14} />
          </button>
        ) : null}
      </div>
      <label className="text-[12px] text-[var(--muted)] sm:col-span-3">
        {tr("newPassword")}
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={tr("leaveBlankPassword")}
          className="mt-1 h-8 w-full rounded-md bg-[var(--surface)] px-2 text-[13px] text-[var(--text)] outline-none"
        />
      </label>
      <div className="sm:col-span-3">
        <Button
          variant="primary"
          onClick={() => {
            const patch: Partial<ManagedUser> & { password?: string } = { username, email, role, plan };
            if (password) patch.password = password;
            void onSave(user, patch).then(() => setPassword(""));
          }}
        >
          {tr("save")}
        </Button>
      </div>
    </div>
  );
}
