export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        checked={checked}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0"
      />
      <span
        className={`pointer-events-none absolute inset-0 rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] ${
          checked ? "border-transparent bg-[var(--accent)]" : "border-[var(--border)] bg-[var(--hover)]"
        }`}
      />
      <span
        className="pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
        style={{ left: checked ? 22 : 2 }}
      />
    </span>
  );
}
