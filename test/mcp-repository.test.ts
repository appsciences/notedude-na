import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createNoteService, type Note } from "@notedude/core";
import { createMcpNoteRepository, CONNECTOR, LIST_LIMIT } from "../src/mcp-repository.ts";
import { createFakeMcp } from "./fake-mcp.js";

const note = (id: string, content = "hello"): Note => ({
  id, content, pinned: false, tagPinned: false, createdAt: 10, updatedAt: 10,
});
const stored = (content: string, extra = {}) => ({
  content, pinned: false, tag_pinned: false,
  created_at: "1970-01-01T00:00:00.010Z", updated_at: "1970-01-01T00:00:01.000Z", ...extra,
});
const settle = () => sleep(5);

test("the connector is addressed by its display name", () => {
  assert.equal(CONNECTOR, "NoteDude");
});

test("create saves the whole note through save_note, with an ISO creation time", async () => {
  const mcp = createFakeMcp();
  const repo = createMcpNoteRepository(mcp);
  await repo.create(note("n1"));
  const saved = mcp.notes().n1;
  assert.equal(saved.content, "hello");
  assert.equal(saved.created_at, "1970-01-01T00:00:00.010Z");
  assert.equal(saved.pinned, false);
  assert.equal(saved.tag_pinned, false);
});

test("update sends only the changed fields, under the connector's names", async () => {
  const calls: unknown[] = [];
  const mcp = createFakeMcp({ n1: stored("hello") });
  const spy = { ...mcp, callTool: (s: string, t: string, i: unknown) => (calls.push([t, i]), mcp.callTool(s, t, i)) };
  const repo = createMcpNoteRepository(spy);
  await repo.update("n1", { tagPinned: true, updatedAt: 5, isNew: false });
  assert.deepEqual(calls, [["update_note", { id: "n1", tag_pinned: true }]]);
  assert.equal(mcp.notes().n1.tag_pinned, true);
  assert.equal(mcp.notes().n1.content, "hello");
});

test("list decodes notes, includes archived ones, and tolerates missing fields", async () => {
  const mcp = createFakeMcp({
    a: stored("A #archived", { pinned: true, updated_at: "1970-01-01T00:00:02.000Z" }),
    b: { content: "B" },
  });
  const repo = createMcpNoteRepository(mcp);
  assert.deepEqual(await repo.list(), [
    { id: "a", content: "A #archived", pinned: true, tagPinned: false, createdAt: 10, updatedAt: 2000 },
    { id: "b", content: "B", pinned: false, tagPinned: false, createdAt: 0, updatedAt: 0 },
  ]);
  assert.equal((await repo.get("a"))?.pinned, true);
  assert.equal(await repo.get("missing"), undefined);
});

test("hasAny answers from the connector", async () => {
  const mcp = createFakeMcp();
  const repo = createMcpNoteRepository(mcp);
  assert.equal(await repo.hasAny(), false);
  await repo.create(note("n1"));
  assert.equal(await repo.hasAny(), true);
});

test("delete removes the note", async () => {
  const mcp = createFakeMcp({ n1: stored("hello") });
  const repo = createMcpNoteRepository(mcp);
  await repo.delete("n1");
  assert.deepEqual(mcp.notes(), {});
});

test("writes to one note never overlap, and keep their order", async () => {
  const mcp = createFakeMcp({}, { latency: 3 });
  const repo = createMcpNoteRepository(mcp);
  await Promise.all([
    repo.create(note("n1")),
    repo.update("n1", { pinned: true }),
    repo.update("n1", { content: "later" }),
  ]);
  assert.deepEqual(mcp.log.filter((l) => !l.startsWith("list_notes")), [
    "save_note:start n1", "save_note:end n1",
    "update_note:start n1", "update_note:end n1",
    "update_note:start n1", "update_note:end n1",
  ]);
  assert.equal(mcp.notes().n1.content, "later");
});

test("a failed write rejects with the connector's error code and does not block later writes", async () => {
  const mcp = createFakeMcp();
  const repo = createMcpNoteRepository(mcp);
  const failed = repo.update("ghost", { pinned: true });
  const ok = repo.create(note("ghost"));
  await assert.rejects(failed, (e: { code: string }) => e.code === "tool_error");
  await ok;
  assert.equal(mcp.notes().ghost.content, "hello");
});

test("subscribe delivers the notes, refetches after a write, and stops when unsubscribed", async () => {
  const mcp = createFakeMcp({ a: stored("A") });
  const repo = createMcpNoteRepository(mcp);
  const seen: string[][] = [];
  const stop = repo.subscribe((notes) => seen.push(notes.map((n) => n.id).sort()));
  await settle();
  await repo.create(note("b"));
  await settle();
  stop();
  await repo.create(note("c"));
  await settle();
  assert.deepEqual(seen.at(0), ["a"]);
  assert.deepEqual(seen.at(-1), ["a", "b"]);
});

test("a change made elsewhere arrives on the next poll", async () => {
  const mcp = createFakeMcp({ a: stored("A") });
  const repo = createMcpNoteRepository(mcp);
  let latest: readonly Note[] = [];
  repo.subscribe((notes) => { latest = notes; });
  await settle();
  mcp.remoteSet("a", { content: "A, edited on the web" });
  mcp.poll();
  await settle();
  assert.equal(latest[0]?.content, "A, edited on the web");
});

test("a list that was fetched before a local write landed does not undo that write on screen", async () => {
  const mcp = createFakeMcp({ a: stored("A") }, { latency: 10 });
  const repo = createMcpNoteRepository(mcp);
  const seen: boolean[] = [];
  repo.subscribe((notes) => seen.push(notes.find((n) => n.id === "a")!.pinned));
  await sleep(20);
  const write = repo.update("a", { pinned: true });
  mcp.poll(); // this poll reads the store before the pin is written
  await write;
  await sleep(40);
  assert.equal(seen[0], false);
  assert.ok(seen.slice(1).every(Boolean), `pin flickered: ${seen}`);
});

test("a local delete stays deleted in a list fetched before it landed", async () => {
  const mcp = createFakeMcp({ a: stored("A") }, { latency: 10 });
  const repo = createMcpNoteRepository(mcp);
  const seen: number[] = [];
  repo.subscribe((notes) => seen.push(notes.length));
  await sleep(20);
  const write = repo.delete("a");
  mcp.poll();
  await write;
  await sleep(40);
  assert.deepEqual([...new Set(seen)], [1, 0]);
});

test("after a failed write the next list shows what the connector really holds", async () => {
  const mcp = createFakeMcp({ a: stored("A") }, { tools: ["list_notes"] });
  const repo = createMcpNoteRepository(mcp);
  let latest: readonly Note[] = [];
  repo.subscribe((notes) => { latest = notes; });
  await settle();
  await assert.rejects(repo.update("a", { pinned: true }));
  mcp.poll();
  await settle();
  assert.equal(latest[0]?.pinned, false);
});

test("connector failures while watching reach the error callback with their code", async () => {
  const mcp = createFakeMcp({}, { failWith: "needs_reauth" });
  const repo = createMcpNoteRepository(mcp);
  const codes: string[] = [];
  repo.subscribe(() => {}, (e) => codes.push((e as Error & { code: string }).code));
  await settle();
  assert.deepEqual(codes, ["needs_reauth"]);
});

test("reports when the connector holds more notes than one list returns", async () => {
  const many = Object.fromEntries(Array.from({ length: LIST_LIMIT + 1 }, (_, i) => [`n${i}`, stored(`N${i}`)]));
  const flags: boolean[] = [];
  const repo = createMcpNoteRepository(createFakeMcp(many), { onTruncated: (t) => flags.push(t) });
  let count = 0;
  repo.subscribe((notes) => { count = notes.length; });
  await settle();
  assert.equal(count, LIST_LIMIT);
  assert.deepEqual(flags, [true]);
});

test("the core note service runs against the connector repository", async () => {
  const mcp = createFakeMcp();
  let n = 0;
  const repository = createMcpNoteRepository(mcp);
  const service = createNoteService({ repository, clock: { now: () => 7 }, ids: { next: () => `id${++n}` } });
  const created = await service.create({ content: "Buy milk", inheritedFromQuery: "#tasks-today" });
  await service.setPinned(created.id, true);
  await service.changeContent(created.id, "Buy oat milk #tasks-today");
  const [only] = await repository.list();
  assert.equal(only?.content, "Buy oat milk #tasks-today");
  assert.equal(only?.pinned, true);
  assert.equal(only?.createdAt, 7);
});
