export function ModelIcon({
  name,
  iconUrl,
  size = 28,
}: {
  name: string;
  iconUrl?: string;
  size?: number;
}) {
  const letter = (name || "M").trim().charAt(0).toUpperCase();
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className="rounded-lg object-cover"
        style={{ width: size, height: size }}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-[var(--surface)] text-[12px] font-medium text-[var(--secondary)] ring-1 ring-[var(--border)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {letter}
    </span>
  );
}
