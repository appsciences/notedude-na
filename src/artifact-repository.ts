/**
 * The `NoteRepository` port from @notedude/core, backed by a Claude artifact's `db`
 * capability. This is the artifact's counterpart to the web app's Firestore layer.
 *
 * Notes live under `data/users/<id>/`, the one subtree the platform keeps private to each
 * viewer, so sharing the artifact never shares anyone's notes.
 */
import type { Note, NotePatch, NoteRepository } from "@notedude/core";

/** The slice of the artifact `db` capability this adapter calls. */
export interface ArtifactDocSnapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}
export interface ArtifactQuerySnapshot {
  readonly docs: readonly ArtifactDocSnapshot[];
  readonly empty: boolean;
}
export interface ArtifactDocRef {
  get(): Promise<ArtifactDocSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  update(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  collection(name: string): ArtifactCollectionRef;
}
export interface ArtifactQuery {
  limit(n: number): ArtifactQuery;
  get(): Promise<ArtifactQuerySnapshot>;
  onSnapshot(next: (snap: ArtifactQuerySnapshot) => void, error?: (e: unknown) => void): () => void;
}
export interface ArtifactCollectionRef extends ArtifactQuery {
  doc(id: string): ArtifactDocRef;
}
export interface ArtifactDb {
  doc(path: string): ArtifactDocRef;
}

export interface ArtifactNoteRepository extends NoteRepository {
  subscribe(listener: (notes: readonly Note[]) => void, onError?: (error: Error) => void): () => void;
  /** Whether the viewer has any note at all, read from the store rather than a snapshot. */
  hasAny(): Promise<boolean>;
  /** Permanent. The core port has no delete; the web app added one for archived notes. */
  delete(id: string): Promise<void>;
}

// `data/users/<id>` is a collection, so the notes hang off one document inside it.
const userDocPath = (userId: string) => `data/users/${userId}/notedude`;

export function notesPath(userId: string): string {
  return `${userDocPath(userId)}/notes`;
}

function decode(snapshot: ArtifactDocSnapshot): Note {
  const d = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    content: typeof d.content === "string" ? d.content : "",
    pinned: d.pinned === true,
    tagPinned: d.tagPinned === true,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : 0,
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
    ...(typeof d.isNew === "boolean" ? { isNew: d.isNew } : {}),
  };
}

function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  const { code, message } = (e ?? {}) as { code?: string; message?: string };
  return Object.assign(new Error(message ?? String(e)), { code });
}

export function createArtifactNoteRepository(
  db: ArtifactDb,
  userId: string,
  clock: { now(): number } = Date,
): ArtifactNoteRepository {
  if (!userId.trim()) throw new Error("A user ID is required");
  const notes = db.doc(userDocPath(userId)).collection("notes");

  // The store wants one write at a time per document. The app fires writes without
  // awaiting them, so each note gets a queue: writes run in call order, never overlapping,
  // and one that fails does not hold up those behind it.
  const tails = new Map<string, Promise<void>>();
  function enqueue(id: string, write: () => Promise<void>): Promise<void> {
    const run = (tails.get(id) ?? Promise.resolve()).then(write);
    const tail = run.catch(() => {});
    tails.set(id, tail);
    void tail.then(() => {
      if (tails.get(id) === tail) tails.delete(id);
    });
    return run;
  }

  return {
    async list() {
      return (await notes.get()).docs.map(decode);
    },
    async get(id) {
      const snapshot = await notes.doc(id).get();
      return snapshot.exists ? decode(snapshot) : undefined;
    },
    create(note) {
      const { id, ...body } = note;
      return enqueue(id, () => notes.doc(id).set({ ...body, updatedAt: clock.now() }));
    },
    update(id, patch: NotePatch) {
      return enqueue(id, () => notes.doc(id).update({ ...patch, updatedAt: clock.now() }));
    },
    subscribe(listener, onError) {
      return notes.onSnapshot(
        (snapshot) => listener(snapshot.docs.map(decode)),
        (e) => onError?.(toError(e)),
      );
    },
    delete(id) {
      return enqueue(id, () => notes.doc(id).delete());
    },
    async hasAny() {
      return !(await notes.limit(1).get()).empty;
    },
  };
}
