import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "subtle" | "danger";
  size?: "sm" | "md" | "icon";
};

export function Button({ className, variant = "subtle", size = "md", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg text-[13px] font-medium transition disabled:opacity-40",
        size === "sm" && "h-8 px-2.5",
        size === "md" && "h-9 px-3.5",
        size === "icon" && "h-8 w-8",
        variant === "primary" && "bg-[var(--accent)] text-white hover:opacity-90",
        variant === "ghost" && "text-[var(--secondary)] hover:bg-[var(--hover)] hover:text-[var(--text)]",
        variant === "subtle" && "bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]",
        variant === "danger" && "text-[var(--danger)] hover:bg-[var(--hover)]",
        className,
      )}
      {...props}
    />
  );
}
