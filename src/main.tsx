/**
 * The artifact's entry point: what `src/app/page.tsx` is to the web app.
 *
 * Google sign-in has no place here, because the Claude viewer already knows who is looking.
 * So this looks for the viewer's NoteDude connector, then mounts the same `App` the web app
 * does: synced through the connector when it is there, otherwise in the app's own demo mode.
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "notedude2-app";
import { AccountHeader, AppSlot, LoadingScreen, ThemeProvider, useTheme } from "@notedude/ui";
import { CONNECTOR, createMcpNoteRepository, type McpClient } from "./mcp-repository.ts";
import { connectNotes, onSyncStatus, reportTruncated, type SyncStatus } from "./notes.ts";
import { ensureStorage, reconcileStoredTheme, viewerTheme, type ThemeName } from "./theme.ts";

type Session =
  | { mode: "loading" }
  | { mode: "synced" }
  /** `connector` says why the notes are local: no Claude runtime, or the connector's state. */
  | { mode: "local"; connector: "none" | "missing" | "needs_reauth" };

interface McpCapability extends McpClient {
  listTools(server?: string): Promise<{ servers: { server: string; authStatus: string; tools: unknown[] }[] }>;
}
interface ClaudeRuntime {
  use(name: "mcp"): Promise<McpCapability | null>;
}

// The app only asks whether it has an account; which one is the connector's business.
const ACCOUNT = "notedude-connector";

async function openSession(): Promise<Session> {
  const claude = (window as { claude?: ClaudeRuntime }).claude;
  if (!claude?.use) return { mode: "local", connector: "none" };
  try {
    const mcp = await claude.use("mcp");
    if (!mcp) return { mode: "local", connector: "none" };
    // Listing never prompts. A connector the viewer has not been asked about yet still
    // lists, and the first call on it asks.
    const listed = await mcp.listTools(CONNECTOR);
    const server = listed.servers.find((s) => s.server === CONNECTOR);
    if (!server || server.tools.length === 0) return { mode: "local", connector: "missing" };
    if (server.authStatus === "needs_reauth") return { mode: "local", connector: "needs_reauth" };
    connectNotes(createMcpNoteRepository(mcp, { onTruncated: reportTruncated }));
    return { mode: "synced" };
  } catch (err) {
    console.error("Could not reach the NoteDude connector:", err);
    return { mode: "local", connector: "missing" };
  }
}

const WHERE = "Claude settings → Connectors";

// Each connector failure has a different fix, so each gets its own wording.
function problemText(code: string): string {
  switch (code) {
    case "needs_reauth":
      return `reconnect ${CONNECTOR} in ${WHERE}`;
    case "server_not_connected":
    case "server_not_found":
    case "selection_required":
      return `add or choose the ${CONNECTOR} connector in ${WHERE}`;
    case "not_in_manifest":
    case "consent_required":
    case "not_granted":
      return `${CONNECTOR} is not allowed for this page`;
    case "blocked_by_policy":
    case "approval_required":
      return `your organization blocks ${CONNECTOR} here`;
    case "tool_error":
    case "bad_request":
      return `${CONNECTOR} refused the request`;
    default:
      return `can't reach ${CONNECTOR} right now`;
  }
}

const LOCAL_TEXT = {
  none: "demo mode · notes stay in this browser",
  missing: `demo mode · add the ${CONNECTOR} connector in ${WHERE} to sync`,
  needs_reauth: `demo mode · reconnect ${CONNECTOR} in ${WHERE} to sync`,
};

/** The strip above the app: where notes are kept, or what the viewer needs to do next. */
function StatusLine({ session, focused, sync }: { session: Session; focused: boolean; sync: SyncStatus }) {
  const { c } = useTheme();
  if (sync.saveProblem) {
    return <span role="alert" style={{ color: c.fg.danger }}>not saved: {problemText(sync.saveProblem)}</span>;
  }
  if (sync.readProblem) {
    return <span role="alert" style={{ color: c.fg.danger }}>not syncing: {problemText(sync.readProblem)}</span>;
  }
  // Keys only reach the page once the artifact frame has focus, which takes one click.
  if (!focused) return <span>click here to use the keyboard</span>;
  if (session.mode === "local") return <span>{LOCAL_TEXT[session.connector]}</span>;
  return <span>{sync.truncated ? "synced · showing your 100 most recent notes" : `synced with ${CONNECTOR}`}</span>;
}

function Shell({ initialTheme }: { initialTheme: ThemeName }) {
  const [session, setSession] = useState<Session>({ mode: "loading" });
  const [theme, setTheme] = useState<ThemeName>(initialTheme);
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [sync, setSync] = useState<SyncStatus>({ saveProblem: null, readProblem: null, truncated: false });

  useEffect(() => {
    let live = true;
    openSession().then((s) => { if (live) setSession(s); });
    return () => { live = false; };
  }, []);

  useEffect(() => onSyncStatus(setSync), []);

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
              <StatusLine session={session} focused={focused} sync={sync} />
            </AccountHeader>
            <AppSlot>
              {session.mode === "synced" ? <App uid={ACCOUNT} /> : <App demo />}
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
