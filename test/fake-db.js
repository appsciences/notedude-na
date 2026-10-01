// An in-memory stand-in for the artifact `db` capability, covering the calls the app makes.
// Plain JS on purpose: the unit tests import it, and the browser tests inject its source
// into the page before the app boots.
export function createFakeDb(initial = {}, options = {}) {
  const docs = new Map(Object.entries(initial));
  const listeners = new Set();
  const log = [];
  const latency = options.latency ?? 0;
  const persist = options.persist ?? (() => {});
  const metadata = { fromCache: false, hasPendingWrites: false };

  const wait = () => new Promise((resolve) => setTimeout(resolve, latency));
  const segments = (path) => path.split("/");

  const docSnapshot = (path) => {
    const data = docs.get(path);
    return { id: segments(path).pop(), exists: data !== undefined, data: () => data, metadata };
  };

  const querySnapshot = (prefix, limit) => {
    const matched = [...docs.keys()]
      .filter((path) => path.startsWith(prefix + "/") && !path.slice(prefix.length + 1).includes("/"))
      .sort()
      .slice(0, limit ?? Infinity)
      .map(docSnapshot);
    return { docs: matched, size: matched.length, empty: matched.length === 0, docChanges: () => [], metadata };
  };

  const changed = () => {
    persist(Object.fromEntries(docs));
    for (const listener of listeners) listener.next(querySnapshot(listener.prefix, listener.limit));
  };

  function doc(path) {
    if (segments(path).length % 2 !== 0) throw new TypeError(`document path needs an even number of segments: ${path}`);
    return {
      id: segments(path).pop(),
      path,
      async get() {
        return docSnapshot(path);
      },
      async set(data) {
        log.push(`set:start ${path}`);
        await wait();
        docs.set(path, JSON.parse(JSON.stringify(data)));
        log.push(`set:end ${path}`);
        changed();
      },
      async update(data) {
        log.push(`update:start ${path}`);
        await wait();
        if (!docs.has(path)) throw { code: "invalid_argument", message: "document does not exist" };
        docs.set(path, { ...docs.get(path), ...JSON.parse(JSON.stringify(data)) });
        log.push(`update:end ${path}`);
        changed();
      },
      async delete() {
        await wait();
        docs.delete(path);
        changed();
      },
      collection(name) {
        return collection(`${path}/${name}`);
      },
    };
  }

  function collection(path) {
    if (segments(path).length % 2 !== 1) throw new TypeError(`collection path needs an odd number of segments: ${path}`);
    const query = (limit) => ({
      limit: (n) => query(n),
      async get() {
        return querySnapshot(path, limit);
      },
      onSnapshot(next) {
        const listener = { prefix: path, limit, next };
        listeners.add(listener);
        queueMicrotask(() => {
          if (listeners.has(listener)) next(querySnapshot(path, limit));
        });
        return () => listeners.delete(listener);
      },
    });
    return { path, doc: (id) => doc(`${path}/${id}`), ...query() };
  }

  return { doc, collection, log, dump: () => Object.fromEntries(docs) };
}
