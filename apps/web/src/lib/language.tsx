import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { t, applyTextSize, type UiLang } from "@/lib/i18n";

const STORAGE = "qv7-lang";

type Ctx = {
  lang: UiLang;
  setLang: (lang: UiLang) => void;
};

const LanguageContext = createContext<Ctx>({
  lang: "en",
  setLang: () => undefined,
});

function detectLang(): UiLang {
  try {
    const stored = localStorage.getItem(STORAGE);
    if (stored === "nl" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("nl")) return "nl";
  return "en";
}

function applyLang(lang: UiLang) {
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE, lang);
  } catch {
    /* ignore */
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(() => (typeof window === "undefined" ? "en" : detectLang()));

  const setLang = useCallback((next: UiLang) => {
    setLangState(next);
    applyLang(next);
  }, []);

  useEffect(() => {
    applyLang(lang);
    api
      .get("/api/settings")
      .then((data) => {
        if (data.language === "nl" || data.language === "en") setLang(data.language);
        if (typeof data.textSize === "number") applyTextSize(data.textSize);
      })
      .catch(() => undefined);
  }, [setLang]);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang() {
  return useContext(LanguageContext);
}

export function useT() {
  const { lang } = useLang();
  return useCallback((key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => t(lang, key, vars), [lang]);
}
