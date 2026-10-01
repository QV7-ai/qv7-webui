import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/language";

async function download(path: string, fallback: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Download failed." }));
    throw new Error(data.error || "Download failed.");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const match = res.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] || fallback;
  link.click();
  URL.revokeObjectURL(url);
}

function Row({
  title,
  hint,
  action,
  busy,
  onClick,
}: {
  title: string;
  hint: string;
  action: string;
  busy?: boolean;
  onClick: () => void;
}) {
  const tr = useT();
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <span>
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="mt-1 block text-[13px] text-[var(--muted)]">{hint}</span>
      </span>
      <Button disabled={busy} onClick={onClick}>
        {busy ? tr("working") : action}
      </Button>
    </div>
  );
}

export function DatabasePanel() {
  const tr = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setStatus("");
    try {
      await work();
      setStatus(tr("done"));
      setTimeout(() => setStatus(""), 1200);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : tr("couldNotExport"));
    } finally {
      setBusy("");
    }
  }

  async function importConfig(file: File) {
    const text = await file.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(tr("invalidJson"));
    }
    const res = await fetch("/api/admin/database/config", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ error: "Import failed." }));
    if (!res.ok) throw new Error(data.error || "Import failed.");
  }

  return (
    <div className="max-w-xl pr-8">
      <h2 className="text-[22px] font-medium">{tr("databaseNav")}</h2>
      {status ? <p className="mt-2 text-[12px] text-[var(--muted)]">{status}</p> : null}
      <h3 className="mt-6 text-[15px] font-medium">{tr("config")}</h3>
      <div className="divide-y divide-[var(--border)]">
        <Row
          title={tr("importConfig")}
          hint={tr("importConfigHint")}
          action={tr("import")}
          busy={busy === "import"}
          onClick={() => fileRef.current?.click()}
        />
        <Row
          title={tr("exportConfig")}
          hint={tr("exportConfigHint")}
          action={tr("export")}
          busy={busy === "config"}
          onClick={() => void run("config", () => download("/api/admin/database/config", "qv7-config.json"))}
        />
      </div>
      <h3 className="mt-6 text-[15px] font-medium">{tr("exportSection")}</h3>
      <div className="divide-y divide-[var(--border)]">
        <Row
          title={tr("databaseFile")}
          hint={tr("databaseFileHint")}
          action={tr("databaseFile")}
          busy={busy === "db"}
          onClick={() => void run("db", () => download("/api/admin/database/file", "qv7.db"))}
        />
        <Row
          title={tr("allChats")}
          hint={tr("allChatsHint")}
          action={tr("export")}
          busy={busy === "chats"}
          onClick={() => void run("chats", () => download("/api/admin/database/chats", "qv7-chats.json"))}
        />
        <Row
          title={tr("users")}
          hint={tr("usersExportHint")}
          action={tr("export")}
          busy={busy === "users"}
          onClick={() => void run("users", () => download("/api/admin/database/users", "qv7-users.csv"))}
        />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run("import", () => importConfig(file));
        }}
      />
    </div>
  );
}
