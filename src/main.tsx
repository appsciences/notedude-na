/**
 * The artifact's entry point: what `src/app/page.tsx` is to the web app.
 *
 * Google sign-in has no place here, because the Claude viewer already knows who is looking.
 * So this resolves the viewer and their notes, then mounts the same `App` the web app does:
 * synced when the artifact database is available, otherwise in the app's own demo mode.
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "notedude2-app";
import { AccountHeader, AppSlot, LoadingScreen, ThemeProvider, useTheme } from "@notedude/ui";
import type { ArtifactDb } from "./artifact-repository.ts";
import { connectNotes, onSaveResult } from "./notes.ts";
import { ensureStorage, reconcileStoredTheme, viewerTheme, type ThemeName } from "./theme.ts";

type Session = { mode: "loading" } | { mode: "synced"; uid: string } | { mode: "local" };

interface ClaudeRuntime {
  use(name: "db"): Promise<ArtifactDb | null>;
  use(name: "user"): Promise<{ id(): Promise<string | null> } | null>;
}

async function openSession(): Promise<Session> {
  const claude = (window as { claude?: ClaudeRuntime }).claude;
  if (!claude?.use) return { mode: "local" };
  try {
    const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
    const uid = user ? await user.id() : null;
    if (!db || !uid) return { mode: "local" };
    connectNotes(db, uid);
    return { mode: "synced", uid };
  } catch (err) {
    console.error("Could not open the artifact database:", err);
    return { mode: "local" };
  }
}

const SAVE_FAILURES: Record<string, string> = {
  quota_exceeded: "not saved: this artifact's storage is full",
  invalid_argument: "not saved: you can't save notes on this artifact",
};

/** The strip above the app: where notes are kept, or what the viewer needs to do next. */
function StatusLine({ session, focused, saveFailure }: {
  session: Session;
  focused: boolean;
  saveFailure: string | null;
}) {
  const { c } = useTheme();
  if (saveFailure) {
    return (
      <span role="alert" style={{ color: c.fg.danger }}>
        {SAVE_FAILURES[saveFailure] ?? "not saved: changes are only on this screen"}
      </span>
    );
  }
  // Keys only reach the page once the artifact frame has focus, which takes one click.
  if (!focused) return <span>click here to use the keyboard</span>;
  return (
    <span>
      {session.mode === "synced"
        ? "synced · private to you"
        : "demo mode · notes stay in this browser"}
    </span>
  );
}

function Shell({ initialTheme }: { initialTheme: ThemeName }) {
  const [session, setSession] = useState<Session>({ mode: "loading" });
  const [theme, setTheme] = useState<ThemeName>(initialTheme);
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [saveFailure, setSaveFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    openSession().then((s) => { if (live) setSession(s); });
    return () => { live = false; };
  }, []);

  useEffect(() => onSaveResult((failure) => setSaveFailure(failure?.code ?? null)), []);

  useEffect(() => {
    const sync = () => setFocused(document.hasFocus());
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  }, []);

  // The app owns its theme and announces it on its root element. Mirroring that keeps this
  // frame and the page behind it in step when the user toggles with `d → m`.
  useEffect(() => {
    const read = () => {
      const name = document.querySelector('[data-testid="app"]')?.getAttribute("data-theme");
      if (name === "dark" || name === "light") setTheme(name);
    };
    const observer = new MutationObserver(read);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-theme"] });
    read();
    return () => observer.disconnect();
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <Frame>
        {session.mode === "loading" ? (
          <LoadingScreen />
        ) : (
          <>
            <AccountHeader>
              <StatusLine session={session} focused={focused} saveFailure={saveFailure} />
            </AccountHeader>
            <AppSlot>
              {session.mode === "synced" ? <App uid={session.uid} /> : <App demo />}
            </AppSlot>
          </>
        )}
      </Frame>
    </ThemeProvider>
  );
}

/**
 * AppShell from @notedude/ui, sized to the page instead of `100vh`: the artifact viewer
 * pads the page for a phone's safe areas, and a viewport-tall frame would overflow it.
 */
function Frame({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  useEffect(() => {
    document.body.style.background = c.bg.app;
  }, [c.bg.app]);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: c.bg.app, overflow: "hidden" }}>
      {children}
    </div>
  );
}

ensureStorage(window);
const initialTheme = reconcileStoredTheme(
  window.localStorage,
  viewerTheme(
    document.documentElement.getAttribute("data-theme"),
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  ),
);
window.focus();
createRoot(document.getElementById("root")!).render(<Shell initialTheme={initialTheme} />);
