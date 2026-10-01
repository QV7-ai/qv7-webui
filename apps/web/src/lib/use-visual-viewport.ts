import { useEffect } from "react";

/** Size the app to the visible viewport. Never shift it down with offsetTop (that double-counts the iPhone inset). */
export function useVisualViewportLock() {
  useEffect(() => {
    const root = document.documentElement;

    function apply() {
      const vv = window.visualViewport;
      const inner = window.innerHeight || 0;
      const raw = Math.round(vv?.height ?? inner);
      const height = inner > 0 ? Math.min(raw, inner) : raw;
      const focused = document.activeElement;
      const typing =
        focused instanceof HTMLElement &&
        (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT" || focused.isContentEditable);
      const shrink = Math.max(0, inner - height);
      root.style.setProperty("--app-height", `${height}px`);
      root.classList.toggle("keyboard-open", typing && shrink > 160);
      window.scrollTo(0, 0);
    }

    apply();
    window.visualViewport?.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", apply);
    window.addEventListener("focusin", apply);
    window.addEventListener("focusout", apply);
    return () => {
      window.visualViewport?.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("focusin", apply);
      window.removeEventListener("focusout", apply);
      root.style.removeProperty("--app-height");
      root.classList.remove("keyboard-open");
    };
  }, []);
}
