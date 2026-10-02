import { useEffect, useState, type FormEvent } from "react";
import { WORK_GROUPS, WORK_ROLES } from "@wlfv/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { useAutoSave } from "@/components/settings/useAutoSave";
import { t, type UiLang } from "@/lib/i18n";

const inputClass =
  "mt-1 h-9 w-full rounded-lg bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] outline-none";

export function AccountPanel({
  language,
  onProfileChange,
}: {
  language: UiLang;
  onProfileChange?: (user: { username: string; email: string; displayName?: string }) => void;
}) {
  const lang = language;
  const [displayName, setDisplayName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [work, setWork] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [gender, setGender] = useState("");
  const [birthday, setBirthday] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [ready, setReady] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const profile = { displayName, preferredName, work, username, bio, gender, birthday, email };
  const { saving, status } = useAutoSave(profile, ready, async (next) => {
    const data = await api.send("/api/account", "PATCH", next);
    onProfileChange?.({
      username: data.user.username,
      email: data.user.email,
      displayName: data.user.displayName,
    });
  });

  useEffect(() => {
    api
      .get("/api/account")
      .then((d) => {
        setDisplayName(d.user.displayName || d.user.username || "");
        setPreferredName(d.user.preferredName || "");
        setWork(d.user.work || "");
        setUsername(d.user.username || "");
        setBio(d.user.bio || "");
        setGender(d.user.gender || "");
        setBirthday(d.user.birthday || "");
        setEmail(d.user.email || "");
        setReady(true);
      })
      .catch(() => undefined);
  }, []);

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setSavingPassword(true);
    setPasswordError("");
    setPasswordMessage("");
    if (newPassword !== confirmPassword) {
      setPasswordError(t(lang, "passwordMismatch"));
      setSavingPassword(false);
      return;
    }
    try {
      await api.send("/api/account", "PATCH", {
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage(t(lang, "passwordUpdated"));
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : t(lang, "accountUpdateError"));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div>
      <h2 className="text-[22px] font-medium">{t(lang, "account")}</h2>
      <form className="mt-6 max-w-md space-y-4" onSubmit={(event) => event.preventDefault()}>
        <label className="block text-[13px]">
          {t(lang, "accountName")}
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className={inputClass}
            autoComplete="name"
            maxLength={80}
            required
          />
        </label>
        <label className="block text-[13px]">
          {t(lang, "accountCallName")}{" "}
          <span className="align-middle text-[11px] font-normal text-[var(--muted)]">{t(lang, "experimental")}</span>
          <input
            value={preferredName}
            onChange={(event) => setPreferredName(event.target.value)}
            className={inputClass}
            maxLength={80}
            autoComplete="off"
          />
          <span className="mt-1 block text-[12px] text-[var(--muted)]">{t(lang, "accountCallNameHint")}</span>
        </label>
        <label className="block text-[13px]">
          {t(lang, "accountWork")}{" "}
          <span className="align-middle text-[11px] font-normal text-[var(--muted)]">{t(lang, "experimental")}</span>
          <select value={work} onChange={(event) => setWork(event.target.value)} className={inputClass}>
            <option value="">{t(lang, "genderUnspecified")}</option>
            {WORK_GROUPS.map((group) => (
              <optgroup key={group.id} label={group[lang]}>
                {WORK_ROLES.filter((role) => role.group === group.id).map((role) => (
                  <option key={role.id} value={role.id}>
                    {role[lang]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="mt-1 block text-[12px] text-[var(--muted)]">{t(lang, "accountWorkHint")}</span>
        </label>
        <label className="block text-[13px]">
          {t(lang, "accountUsername")}
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={inputClass}
            autoComplete="username"
            maxLength={30}
            required
          />
          <span className="mt-1 block text-[12px] text-[var(--muted)]">{t(lang, "usernameHint")}</span>
        </label>
        <label className="block text-[13px]">
          {t(lang, "accountBio")}
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            rows={4}
            maxLength={500}
            className="mt-1 w-full resize-none rounded-lg bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
            placeholder={t(lang, "bioPlaceholder")}
          />
        </label>
        <label className="block text-[13px]">
          {t(lang, "accountGender")}
          <select value={gender} onChange={(event) => setGender(event.target.value)} className={inputClass}>
            <option value="">{t(lang, "genderUnspecified")}</option>
            <option value="female">{t(lang, "genderFemale")}</option>
            <option value="male">{t(lang, "genderMale")}</option>
            <option value="non-binary">{t(lang, "genderNonBinary")}</option>
            <option value="prefer-not">{t(lang, "genderPreferNot")}</option>
            <option value="other">{t(lang, "genderOther")}</option>
          </select>
        </label>
        <label className="block text-[13px]">
          {t(lang, "accountBirthday")}
          <input type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} className={inputClass} />
        </label>
        <label className="block text-[13px]">
          {t(lang, "accountEmail")}
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            autoComplete="email"
          />
        </label>
        <SettingsSaveBar saving={saving} status={status} />
      </form>
      <form className="mt-10 max-w-md space-y-4" onSubmit={(event) => void savePassword(event)}>
        <h3 className="text-[16px] font-medium">{t(lang, "changePassword")}</h3>
        <label className="block text-[13px]">
          {t(lang, "currentPassword")}
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className={inputClass}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="block text-[13px]">
          {t(lang, "newPassword")}
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={inputClass}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </label>
        <label className="block text-[13px]">
          {t(lang, "confirmPassword")}
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={inputClass}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </label>
        {passwordError ? <p className="text-[13px] text-[var(--danger)]">{passwordError}</p> : null}
        {passwordMessage ? <p className="text-[13px] text-[var(--accent)]">{passwordMessage}</p> : null}
        <Button type="submit" variant="primary" disabled={savingPassword}>
          {savingPassword ? t(lang, "saving") : t(lang, "updatePassword")}
        </Button>
      </form>
      <Button
        className="mt-8"
        onClick={() =>
          void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).then(() => location.assign("/login"))
        }
      >
        {t(lang, "signOut")}
      </Button>
    </div>
  );
}
