import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import type { PublicBranding } from "@wlfv/shared";
import { api } from "@/lib/api";
import LoginPage from "@/pages/LoginPage";
import ChatPage from "@/pages/ChatPage";
import { PendingOverlay } from "@/components/auth/PendingOverlay";
import { applyPublicBranding, asPublicBranding, EMPTY_BRANDING } from "@/lib/branding";
import { applyWebApp } from "@/lib/pwa";
import { useVisualViewportLock } from "@/lib/use-visual-viewport";
import { LanguageProvider } from "@/lib/language";

function useMotionEnabled() {
  const [enabled, setEnabled] = useState(() => document.documentElement.dataset.motion !== "off");
  useEffect(() => {
    const sync = () => setEnabled(document.documentElement.dataset.motion !== "off");
    window.addEventListener("qv7-motion", sync);
    return () => window.removeEventListener("qv7-motion", sync);
  }, []);
  return enabled;
}

export default function App() {
  useVisualViewportLock();
  const motionOn = useMotionEnabled();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<{ username: string; displayName: string; role: string } | null>(null);
  const [pending, setPending] = useState<{ title: string; content: string; adminContactEmail: string } | null>(null);
  const [branding, setBranding] = useState<PublicBranding>(EMPTY_BRANDING);

  useEffect(() => {
    api
      .get("/api/branding")
      .then((data) => {
        const next = asPublicBranding(data);
        setBranding(next);
        applyPublicBranding(next);
        void applyWebApp(next);
      })
      .catch(() => undefined);
    api
      .get("/api/auth/me")
      .then((d) => {
        setUser(
          d.user
            ? { username: d.user.username, role: d.user.role, displayName: d.user.displayName || d.user.username }
            : null,
        );
        setPending(d.user?.role === "pending" ? d.pending ?? null : null);
      })
      .catch(() => {
        setUser(null);
        setPending(null);
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="h-full bg-[var(--bg)]" />;

  return (
    <MotionConfig reducedMotion={motionOn ? "never" : "always"}>
    <LanguageProvider>
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/chat" replace /> : <LoginPage branding={branding} />} />
      <Route
        element={
          user ? (
            user.role === "pending" ? (
              <PendingOverlay
                title={pending?.title}
                content={pending?.content}
                adminContactEmail={pending?.adminContactEmail}
              />
            ) : (
              <ChatPage
                branding={branding}
                username={user.username}
                displayName={user.displayName || user.username}
                isAdmin={user.role === "admin"}
                onUserUpdate={(next) =>
                  setUser((current) =>
                    current ? { ...current, username: next.username, displayName: next.displayName || next.username } : current,
                  )
                }
                onBrandingChange={(next) => {
                  const branding = asPublicBranding(next);
                  setBranding(branding);
                  applyPublicBranding(branding);
                  void applyWebApp(branding);
                }}
              />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route path="/chat/:conversationId?" element={<Outlet />} />
        <Route path="/skills" element={<Outlet />} />
      </Route>
      <Route path="/settings/*" element={<Navigate to="/chat?settings=1" replace />} />
      <Route path="/admin/*" element={<Navigate to="/chat?settings=admin" replace />} />
      <Route path="*" element={<Navigate to={user ? "/chat" : "/login"} replace />} />
    </Routes>
    </LanguageProvider>
    </MotionConfig>
  );
}
