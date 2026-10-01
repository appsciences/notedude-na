import assert from "node:assert/strict";
import { test } from "node:test";
import { createNoteService } from "@notedude/core";
import { createArtifactNoteRepository, notesPath } from "../src/artifact-repository.ts";
import { createFakeDb } from "./fake-db.js";

const UID = "u_test";
const path = (id: string) => `${notesPath(UID)}/${id}`;
const note = (id: string, content = "hello") => ({
  id, content, pinned: false, tagPinned: false, createdAt: 10, updatedAt: 10,
});

test("notes live in the viewer's private subtree", () => {
  assert.equal(notesPath(UID), "data/users/u_test/notedude/notes");
});

test("a user id is required", () => {
  assert.throws(() => createArtifactNoteRepository(createFakeDb(), " "), /user ID/);
});

test("create writes the whole note under its id, stamped by the clock, without the id field", async () => {
  const db = createFakeDb();
  const repo = createArtifactNoteRepository(db, UID, { now: () => 99 });
  await repo.create(note("n1"));
  assert.deepEqual(db.dump()[path("n1")], {
    content: "hello", pinned: false, tagPinned: false, createdAt: 10, updatedAt: 99,
  });
});

test("update merges a patch and leaves other fields alone", async () => {
  const db = createFakeDb({ [path("n1")]: { content: "hello", pinned: false, tagPinned: false, createdAt: 10, updatedAt: 10 } });
  const repo = createArtifactNoteRepository(db, UID, { now: () => 50 });
  await repo.update("n1", { pinned: true });
  assert.deepEqual(db.dump()[path("n1")], {
    content: "hello", pinned: true, tagPinned: false, createdAt: 10, updatedAt: 50,
  });
});

test("list and get decode stored documents, tolerating missing fields", async () => {
  const db = createFakeDb({
    [path("a")]: { content: "A", pinned: true, tagPinned: false, createdAt: 1, updatedAt: 2 },
    [path("b")]: {},
    "data/users/u_other/notedude/notes/x": { content: "not mine" },
  });
  const repo = createArtifactNoteRepository(db, UID);
  assert.deepEqual(await repo.list(), [
    { id: "a", content: "A", pinned: true, tagPinned: false, createdAt: 1, updatedAt: 2 },
    { id: "b", content: "", pinned: false, tagPinned: false, createdAt: 0, updatedAt: 0 },
  ]);
  assert.equal((await repo.get("a"))?.content, "A");
  assert.equal(await repo.get("missing"), undefined);
});

test("hasAny answers whether the account holds a note", async () => {
  const db = createFakeDb();
  const repo = createArtifactNoteRepository(db, UID);
  assert.equal(await repo.hasAny(), false);
  await repo.create(note("n1"));
  assert.equal(await repo.hasAny(), true);
});

test("subscribe delivers the current notes, then every change, until unsubscribed", async () => {
  const db = createFakeDb();
  const repo = createArtifactNoteRepository(db, UID);
  const seen: string[][] = [];
  const stop = repo.subscribe((notes) => seen.push(notes.map((n) => n.id)));
  await Promise.resolve();
  await repo.create(note("n1"));
  stop();
  await repo.create(note("n2"));
  assert.deepEqual(seen, [[], ["n1"]]);
});

test("writes to one note never overlap, and keep their order", async () => {
  const db = createFakeDb({}, { latency: 5 });
  const repo = createArtifactNoteRepository(db, UID);
  // Fired together, as the app does: a save, then two field updates, none awaited.
  const all = Promise.all([
    repo.create(note("n1")),
    repo.update("n1", { pinned: true }),
    repo.update("n1", { content: "later" }),
  ]);
  await all;
  const p = path("n1");
  assert.deepEqual(db.log, [
    `set:start ${p}`, `set:end ${p}`,
    `update:start ${p}`, `update:end ${p}`,
    `update:start ${p}`, `update:end ${p}`,
  ]);
  assert.equal(db.dump()[p].content, "later");
  assert.equal(db.dump()[p].pinned, true);
});

test("a failed write rejects without blocking the writes queued behind it", async () => {
  const db = createFakeDb();
  const repo = createArtifactNoteRepository(db, UID);
  const failed = repo.update("ghost", { pinned: true });
  const ok = repo.create(note("ghost"));
  await assert.rejects(failed, (e: { code: string }) => e.code === "invalid_argument");
  await ok;
  assert.equal(db.dump()[path("ghost")].content, "hello");
});

test("the core note service runs against the artifact repository", async () => {
  const db = createFakeDb();
  let n = 0;
  const repository = createArtifactNoteRepository(db, UID, { now: () => 7 });
  const service = createNoteService({ repository, clock: { now: () => 7 }, ids: { next: () => `id${++n}` } });
  const created = await service.create({ content: "Buy milk", inheritedFromQuery: "#tasks-today" });
  await service.setPinned(created.id, true);
  await service.changeContent(created.id, "Buy oat milk #tasks-today");
  assert.deepEqual(await repository.list(), [
    { id: "id1", content: "Buy oat milk #tasks-today", pinned: true, tagPinned: false, createdAt: 7, updatedAt: 7, isNew: false },
  ]);
});

test("delete removes the note, in order with the writes queued before it", async () => {
  const db = createFakeDb({}, { latency: 2 });
  const repo = createArtifactNoteRepository(db, UID);
  await Promise.all([repo.create(note("n1")), repo.update("n1", { pinned: true }), repo.delete("n1")]);
  assert.equal(db.dump()[path("n1")], undefined);
  assert.deepEqual(await repo.list(), []);
});
