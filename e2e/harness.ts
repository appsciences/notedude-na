import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
export const PAGE_URL = "https://notedude.test/";
const STORE_KEY = "__fakeNoteDude";

// Served from an https address because the app needs a secure context (crypto.randomUUID),
// as it has inside the artifact viewer.
const wrap = (content: string) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
  `</head><body>${content}</body></html>`;

export interface ViewerOptions {
  /** `false` loads the page with no Claude runtime at all. */
  runtime?: boolean;
  /** Whether the viewer has added the NoteDude connector. */
  connected?: boolean;
  /** The tools the connector offers; defaults to the full contract. */
  tools?: string[];
}

// Stands in for the Claude viewer: an `mcp` capability with a NoteDude connector whose
// notes survive a reload.
const fakeViewer = (options: ViewerOptions) => `
${readFileSync(resolve(root, "test/fake-mcp.js"), "utf8").replace("export function", "function")}
(() => {
  const saved = JSON.parse(localStorage.getItem("${STORE_KEY}") ?? "{}");
  const mcp = createFakeMcp(saved, {
    ...${JSON.stringify(options)},
    startClock: Date.now(),
    persist: (notes) => localStorage.setItem("${STORE_KEY}", JSON.stringify(notes)),
  });
  window.claude = { use: async (name) => (name === "mcp" ? mcp : null) };
})();
`;

export async function openArtifact(page: Page, options: ViewerOptions = {}) {
  const html = wrap(readFileSync(resolve(root, "dist/notedude.html"), "utf8"));
  await page.route(PAGE_URL, (route) => route.fulfill({ contentType: "text/html", body: html }));
  if (options.runtime !== false) await page.addInitScript({ content: fakeViewer(options) });
  await page.goto(PAGE_URL);
}

/** The notes the fake connector currently holds, keyed by note id. */
export function storedNotes(page: Page): Promise<Record<string, { content: string; pinned: boolean }>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), STORE_KEY);
}
