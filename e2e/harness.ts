import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
export const PAGE_URL = "https://notedude.test/";
export const NOTES = "data/users/u_test/notedude/notes";
const STORE_KEY = "__fakeArtifactDb";

// The same wrapper the Artifact tool puts around a published page.
// Served from an https address because the app needs a secure context (crypto.randomUUID),
// as it has inside the artifact viewer.
const wrap = (content: string) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
  `</head><body>${content}</body></html>`;

// Stands in for the Claude viewer: a `db` whose contents survive a reload, and a signed-in user.
const fakeViewer = `
${readFileSync(resolve(root, "test/fake-db.js"), "utf8").replace("export function", "function")}
(() => {
  const saved = JSON.parse(localStorage.getItem("${STORE_KEY}") ?? "{}");
  const db = createFakeDb(saved, { persist: (docs) => localStorage.setItem("${STORE_KEY}", JSON.stringify(docs)) });
  const user = { id: async () => "u_test" };
  window.claude = { use: async (name) => (name === "db" ? db : name === "user" ? user : null) };
})();
`;

/** Open the built artifact page. `viewer: false` loads it with no Claude runtime at all. */
export async function openArtifact(page: Page, { viewer = true } = {}) {
  const html = wrap(readFileSync(resolve(root, "dist/notedude.html"), "utf8"));
  await page.route(PAGE_URL, (route) => route.fulfill({ contentType: "text/html", body: html }));
  if (viewer) await page.addInitScript({ content: fakeViewer });
  await page.goto(PAGE_URL);
}

/** What the fake artifact database currently holds, keyed by document path. */
export function storedDocs(page: Page): Promise<Record<string, { content: string; pinned: boolean }>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), STORE_KEY);
}
