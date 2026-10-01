// An in-memory stand-in for the artifact `mcp` capability with a NoteDude connector behind
// it, following the tool contract in spec.md. Plain JS on purpose: the unit tests import
// it, and the browser tests inject its source into the page before the app boots.
export function createFakeMcp(initial = {}, options = {}) {
  const SERVER = "NoteDude";
  const notes = new Map(Object.entries(initial));
  const watchers = new Set();
  const log = [];
  const latency = options.latency ?? 0;
  const persist = options.persist ?? (() => {});
  const connected = options.connected ?? true;
  // The service as deployed today only lists; pass `tools` to model that.
  const tools = options.tools ?? ["list_notes", "save_note", "update_note", "delete_note"];
  let clock = options.startClock ?? 1000;

  const wait = () => new Promise((resolve) => setTimeout(resolve, latency));
  const iso = (ms) => new Date(ms).toISOString();
  const fail = (code, message) => Promise.reject({ code, server: SERVER, message });

  const listPayload = ({ limit = 50, include_archived = false } = {}) => {
    const all = [...notes.entries()]
      .map(([id, n]) => ({ id, ...n }))
      .filter((n) => include_archived || !/#archived(?=[\s,.]|$)/i.test(n.content))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    return { notes: all.slice(0, limit), has_more: all.length > limit };
  };

  const run = {
    list_notes: (input) => listPayload(input ?? {}),
    save_note: ({ id, content, pinned = false, tag_pinned = false, created_at }) => {
      notes.set(id, { content, pinned, tag_pinned, created_at: created_at ?? iso(clock), updated_at: iso(++clock) });
      return { id };
    },
    update_note: ({ id, ...patch }) => {
      if (!notes.has(id)) throw { code: "tool_error", server: SERVER, message: "Note not found." };
      notes.set(id, { ...notes.get(id), ...patch, updated_at: iso(++clock) });
      return { id };
    },
    delete_note: ({ id }) => {
      notes.delete(id);
      return { id };
    },
  };

  async function callTool(server, tool, input) {
    if (server !== SERVER || !connected) return fail("server_not_connected", "No such connector.");
    if (options.failWith) return fail(options.failWith, "Simulated failure.");
    if (!tools.includes(tool)) return fail("tool_error", `Unknown tool: ${tool}`);
    log.push(`${tool}:start ${input?.id ?? ""}`.trim());
    await wait();
    const payload = run[tool](JSON.parse(JSON.stringify(input ?? {})));
    log.push(`${tool}:end ${input?.id ?? ""}`.trim());
    if (tool !== "list_notes") persist(Object.fromEntries(notes));
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, payload };
  }

  function deliver(watcher) {
    callTool(SERVER, watcher.tool, watcher.input).then(
      (result) => watchers.has(watcher) && watcher.handler({ type: "data", result }),
      (error) => watchers.has(watcher) && watcher.handler({ type: "error", error }),
    );
  }

  return {
    log,
    notes: () => Object.fromEntries(notes),
    /** Stands in for a change made elsewhere, e.g. in the web app. */
    remoteSet(id, note) {
      notes.set(id, { pinned: false, tag_pinned: false, created_at: iso(clock), ...note, updated_at: iso(++clock) });
    },
    /** Stands in for the platform's periodic refetch. */
    poll() {
      for (const watcher of watchers) deliver(watcher);
    },
    async listTools() {
      if (!connected) return { servers: [] };
      return { servers: [{ server: SERVER, authStatus: options.authStatus ?? "connected", tools: tools.map((name) => ({ name, description: "" })) }] };
    },
    callTool,
    watchTool(server, tool, input, handler) {
      const watcher = { tool, input, handler };
      watchers.add(watcher);
      queueMicrotask(() => deliver(watcher));
      return () => watchers.delete(watcher);
    },
    async invalidate(server, tool) {
      for (const watcher of watchers) if (!tool || watcher.tool === tool) deliver(watcher);
    },
  };
}
