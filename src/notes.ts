/**
 * Stands in for notedude2's `src/lib/notes.ts` when the app is bundled as an artifact.
 *
 * It keeps that module's exact exports, so `App.tsx` is bundled unmodified; only the
 * storage behind them changes, from Firestore to the NoteDude MCP connector.
 */
import type { SyncedNoteRepository } from "./mcp-repository.ts";

export interface NoteData {
  id: string;
  content: string;
  pinned: boolean;
  tagPinned: boolean;
  createdAt: number;
  updatedAt: number;
  isNew?: boolean;
}

/**
 * What the header needs to know about the connector: the code of the latest failed save
 * or failed refresh (cleared by the next success of the same kind), and whether the
 * account holds more notes than are shown.
 */
export interface SyncStatus {
  saveProblem: string | null;
  readProblem: string | null;
  truncated: boolean;
}

let repository: SyncedNoteRepository | null = null;
let status: SyncStatus = { saveProblem: null, readProblem: null, truncated: false };
const listeners = new Set<(status: SyncStatus) => void>();

function setStatus(change: Partial<SyncStatus>): void {
  const next = { ...status, ...change };
  if (next.saveProblem === status.saveProblem && next.readProblem === status.readProblem && next.truncated === status.truncated) return;
  status = next;
  listeners.forEach((l) => l(status));
}

/** Point the app at the viewer's notes. Called once, before the app mounts. */
export function connectNotes(repo: SyncedNoteRepository): void {
  repository = repo;
}

export function reportTruncated(truncated: boolean): void {
  setStatus({ truncated });
}

export function onSyncStatus(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function repo(): SyncedNoteRepository {
  if (!repository) throw new Error("connectNotes() must run before the app mounts with a uid");
  return repository;
}

const codeOf = (err: unknown) =>
  typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "upstream_error";

// The app's writes are fire-and-forget for optimistic UI; the outcome goes to the header.
function report(what: string, write: Promise<void>): void {
  write.then(
    () => setStatus({ saveProblem: null }),
    (err) => {
      console.error(`Failed to ${what}:`, err);
      setStatus({ saveProblem: codeOf(err) });
    },
  );
}

export function accountHasNotes(_uid: string): Promise<boolean> {
  return repo().hasAny();
}

export function subscribeToNotes(
  _uid: string,
  onNotes: (notes: NoteData[]) => void,
  onError: (err: Error) => void,
) {
  return repo().subscribe(
    (notes) => {
      setStatus({ readProblem: null });
      onNotes(notes.map((n) => ({ ...n })));
    },
    (err) => {
      setStatus({ readProblem: codeOf(err) });
      onError(err);
    },
  );
}

export function saveNote(_uid: string, note: NoteData) {
  report("save note", repo().create(note));
}

export function deleteNote(_uid: string, noteId: string) {
  report("delete note", repo().delete(noteId));
}

export function setNotePinned(_uid: string, noteId: string, pinned: boolean) {
  report("update pin", repo().update(noteId, { pinned }));
}

export function setNoteTagPinned(_uid: string, noteId: string, tagPinned: boolean) {
  report("update tag-pin", repo().update(noteId, { tagPinned }));
}

export function setNoteContent(_uid: string, noteId: string, content: string) {
  report("update note content", repo().update(noteId, { content }));
}
