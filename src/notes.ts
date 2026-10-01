/**
 * Stands in for notedude2's `src/lib/notes.ts` when the app is bundled as an artifact.
 *
 * It keeps that module's exact exports, so `App.tsx` is bundled unmodified; only the
 * storage behind them changes, from Firestore to the artifact repository.
 */
import {
  createArtifactNoteRepository,
  type ArtifactDb,
  type ArtifactNoteRepository,
} from "./artifact-repository.ts";

export interface NoteData {
  id: string;
  content: string;
  pinned: boolean;
  tagPinned: boolean;
  createdAt: number;
  updatedAt: number;
  isNew?: boolean;
}

/** `null` reports a write that succeeded, clearing any earlier failure. */
export type SaveListener = (failure: { code: string } | null) => void;

let repository: ArtifactNoteRepository | null = null;
const saveListeners = new Set<SaveListener>();

/** Point the app at the viewer's notes. Called once, before the app mounts. */
export function connectNotes(db: ArtifactDb, uid: string): void {
  repository = createArtifactNoteRepository(db, uid);
}

export function onSaveResult(listener: SaveListener): () => void {
  saveListeners.add(listener);
  return () => saveListeners.delete(listener);
}

function repo(): ArtifactNoteRepository {
  if (!repository) throw new Error("connectNotes() must run before the app mounts with a uid");
  return repository;
}

// The app's writes are fire-and-forget for optimistic UI; the outcome goes to the header.
function report(what: string, write: Promise<void>): void {
  write.then(
    () => saveListeners.forEach((l) => l(null)),
    (err) => {
      console.error(`Failed to ${what}:`, err);
      const code = typeof err?.code === "string" ? err.code : "unavailable";
      saveListeners.forEach((l) => l({ code }));
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
  return repo().subscribe((notes) => onNotes(notes.map((n) => ({ ...n }))), onError);
}

export function saveNote(_uid: string, note: NoteData) {
  // `isNew` is view state and never stored, as in the web app.
  const { isNew: _isNew, ...stored } = note;
  report("save note", repo().create(stored));
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
