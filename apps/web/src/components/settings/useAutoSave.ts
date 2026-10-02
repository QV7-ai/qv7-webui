import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/language";

export function useAutoSave<T>(value: T, armed: boolean, save: (value: T) => Promise<unknown>, delay = 450) {
  const tr = useT();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const saveRef = useRef(save);
  const labels = useRef(tr);
  const seen = useRef<string | null>(null);
  const dirty = useRef<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  saveRef.current = save;
  labels.current = tr;

  const json = JSON.stringify(value);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!armed) {
      seen.current = null;
      dirty.current = null;
      return;
    }
    if (seen.current === null) {
      seen.current = json;
      return;
    }
    if (seen.current === json) return;
    const snapshot = json;
    dirty.current = snapshot;
    const token = ++generation.current;
    const timer = window.setTimeout(() => {
      dirty.current = null;
      setSaving(true);
      setStatus("");
      void saveRef
        .current(JSON.parse(snapshot) as T)
        .then(() => {
          if (!mounted.current || generation.current !== token) return;
          seen.current = snapshot;
          setStatus(labels.current("saved"));
          window.setTimeout(() => {
            if (mounted.current && generation.current === token) setStatus("");
          }, 1200);
        })
        .catch((err: unknown) => {
          if (!mounted.current || generation.current !== token) return;
          setStatus(err instanceof Error ? err.message : labels.current("couldNotSave"));
        })
        .finally(() => {
          if (mounted.current && generation.current === token) setSaving(false);
        });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [armed, json, delay]);

  useEffect(() => {
    return () => {
      const snapshot = dirty.current;
      if (!snapshot) return;
      dirty.current = null;
      void saveRef.current(JSON.parse(snapshot) as T).catch(() => undefined);
    };
  }, []);

  return { saving, status };
}
