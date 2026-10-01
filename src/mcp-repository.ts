/**
 * The `NoteRepository` port from @notedude/core, backed by the NoteDude MCP service.
 *
 * An artifact cannot open a network connection of its own. It reaches the service through
 * the artifact `mcp` capability, which calls the connector the viewer has added in Claude,
 * with the viewer's credentials. Every note operation the app performs goes through here.
 *
 * The tool contract is in spec.md. Changes made elsewhere arrive by polling, not push.
 */
import type { Note, NotePatch, NoteRepository } from "@notedude/core";

/** The connector's display name in Claude. Viewers are matched to it by this name. */
export const CONNECTOR = "NoteDude";
export const TOOLS = {
  list: "list_notes",
  save: "save_note",
  update: "update_note",
  remove: "delete_note",
} as const;
/** The most the service returns from one `list_notes` call. */
export const LIST_LIMIT = 100;
const POLL_MS = 30_000;
// How long a local change keeps overriding lists that do not show it yet.
const OVERLAY_TTL_MS = 60_000;

interface ToolResult { payload?: unknown }
type WatchEvent = { type: "data"; result: ToolResult } | { type: "error"; error: unknown };

/** The slice of the artifact `mcp` capability this adapter calls. */
export interface McpClient {
  callTool(server: string, tool: string, input?: unknown, options?: unknown): Promise<ToolResult>;
  watchTool(server: string, tool: string, input: unknown, handler: (ev: WatchEvent) => void, options?: unknown): () => void;
  invalidate(server?: string, tool?: string): Promise<void>;
}

export interface SyncedNoteRepository extends NoteRepository {
  subscribe(listener: (notes: readonly Note[]) => void, onError?: (error: Error) => void): () => void;
  /** Whether the account holds any note at all, asked of the service directly. */
  hasAny(): Promise<boolean>;
  /** Permanent. The core port has no delete; the web app added one for archived notes. */
  delete(id: string): Promise<void>;
}

export interface McpRepositoryOptions {
  /** Told after each list whether the account holds more notes than were returned. */
  onTruncated?: (truncated: boolean) => void;
  now?: () => number;
}

function millis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function decode(raw: unknown): Note | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  if (typeof d.id !== "string" || d.id === "") return null;
  return {
    id: d.id,
    content: typeof d.content === "string" ? d.content : "",
    pinned: d.pinned === true,
    tagPinned: d.tag_pinned === true,
    createdAt: millis(d.created_at),
    updatedAt: millis(d.updated_at),
  };
}

function decodeList(result: ToolResult): { notes: Note[]; truncated: boolean } {
  const payload = (result.payload ?? {}) as { notes?: unknown; has_more?: unknown };
  const raw = Array.isArray(payload.notes) ? payload.notes : [];
  const notes = raw.map(decode).filter((n): n is Note => n !== null);
  // `has_more` is the service's own answer; a full page is the best guess without it.
  return { notes, truncated: payload.has_more === true || (payload.has_more === undefined && raw.length >= LIST_LIMIT) };
}

function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  const { code, message } = (e ?? {}) as { code?: string; message?: string };
  return Object.assign(new Error(message ?? String(e)), { code });
}

/** A local change not yet visible in the service's list. `note: null` is a delete. */
interface Overlay { note: Note | null; pending: number; settledAt: number | null }

const sameNote = (a: Note, b: Note) =>
  a.content === b.content && a.pinned === b.pinned && a.tagPinned === b.tagPinned;

export function createMcpNoteRepository(mcp: McpClient, options: McpRepositoryOptions = {}): SyncedNoteRepository {
  const now = options.now ?? Date.now;
  const listInput = { limit: LIST_LIMIT, include_archived: true };
  let remote = new Map<string, Note>();
  const overlays = new Map<string, Overlay>();

  // The service is polled, so a list can be older than a change just made here. Until a
  // list agrees with that change (or it ages out), the change is laid over what is shown,
  // so a pin or an edit never flickers back.
  function visible(): Note[] {
    const notes = new Map(remote);
    for (const [id, overlay] of overlays) {
      const seen = remote.get(id);
      if (overlay.pending === 0 && overlay.settledAt !== null) {
        const agrees = overlay.note === null ? !seen : !!seen && sameNote(seen, overlay.note);
        if (agrees || now() - overlay.settledAt > OVERLAY_TTL_MS) {
          overlays.delete(id);
          continue;
        }
      }
      if (overlay.note === null) notes.delete(id);
      else notes.set(id, { ...overlay.note, updatedAt: seen?.updatedAt ?? overlay.note.updatedAt });
    }
    return [...notes.values()];
  }

  // One write at a time per note, in call order; a failure does not hold up the next.
  const tails = new Map<string, Promise<void>>();
  function write(id: string, next: Note | null | undefined, call: () => Promise<unknown>): Promise<void> {
    const overlay = next === undefined ? undefined : { note: next, pending: (overlays.get(id)?.pending ?? 0) + 1, settledAt: null };
    if (overlay) overlays.set(id, overlay);
    const run = (tails.get(id) ?? Promise.resolve()).then(async () => {
      try {
        await call();
      } catch (e) {
        // The outcome is unknown or refused: stop asserting it and let the next list decide.
        if (overlays.get(id) === overlay) overlays.delete(id);
        throw toError(e);
      }
      const current = overlays.get(id);
      if (current && --current.pending === 0) current.settledAt = now();
      // Ask for a fresh list so every open watcher catches up with this write.
      await mcp.invalidate(CONNECTOR, TOOLS.list).catch(() => {});
    });
    const tail = run.catch(() => {});
    tails.set(id, tail);
    void tail.then(() => {
      if (tails.get(id) === tail) tails.delete(id);
    });
    return run;
  }

  const current = (id: string) => overlays.get(id)?.note ?? remote.get(id);

  async function fetchList(limit: number) {
    return decodeList(await mcp.callTool(CONNECTOR, TOOLS.list, { ...listInput, limit }));
  }

  return {
    async list() {
      return (await fetchList(LIST_LIMIT)).notes;
    },
    async get(id) {
      return (await fetchList(LIST_LIMIT)).notes.find((n) => n.id === id);
    },
    create(note) {
      const { isNew: _isNew, ...kept } = note;
      return write(note.id, kept, () =>
        mcp.callTool(CONNECTOR, TOOLS.save, {
          id: note.id,
          content: note.content,
          pinned: note.pinned,
          tag_pinned: note.tagPinned,
          created_at: new Date(note.createdAt).toISOString(),
        }),
      );
    },
    update(id, patch: NotePatch) {
      const fields = {
        ...(patch.content === undefined ? {} : { content: patch.content }),
        ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
        ...(patch.tagPinned === undefined ? {} : { tagPinned: patch.tagPinned }),
      };
      const base = current(id);
      return write(id, base ? { ...base, ...fields } : undefined, () =>
        mcp.callTool(CONNECTOR, TOOLS.update, {
          id,
          ...(fields.content === undefined ? {} : { content: fields.content }),
          ...(fields.pinned === undefined ? {} : { pinned: fields.pinned }),
          ...(fields.tagPinned === undefined ? {} : { tag_pinned: fields.tagPinned }),
        }),
      );
    },
    delete(id) {
      return write(id, null, () => mcp.callTool(CONNECTOR, TOOLS.remove, { id }));
    },
    subscribe(listener, onError) {
      return mcp.watchTool(
        CONNECTOR,
        TOOLS.list,
        listInput,
        (event) => {
          if (event.type === "error") return onError?.(toError(event.error));
          const { notes, truncated } = decodeList(event.result);
          remote = new Map(notes.map((n) => [n.id, n]));
          options.onTruncated?.(truncated);
          listener(visible());
        },
        { refetchInterval: POLL_MS },
      );
    },
    async hasAny() {
      return (await fetchList(1)).notes.length > 0;
    },
  };
}
