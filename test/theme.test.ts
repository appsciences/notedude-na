import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryStorage, reconcileStoredTheme, viewerTheme } from "../src/theme.ts";

test("an explicit viewer theme beats the system preference", () => {
  assert.equal(viewerTheme("light", true), "light");
  assert.equal(viewerTheme("dark", false), "dark");
});

test("with no explicit theme the system preference decides", () => {
  assert.equal(viewerTheme(null, true), "dark");
  assert.equal(viewerTheme(null, false), "light");
});

test("first visit follows the viewer and remembers that the choice was automatic", () => {
  const storage = memoryStorage();
  assert.equal(reconcileStoredTheme(storage, "light"), "light");
  assert.equal(storage.getItem("theme"), "light");
  // Still automatic, so a later visit in dark follows the viewer again.
  assert.equal(reconcileStoredTheme(storage, "dark"), "dark");
  assert.equal(storage.getItem("theme"), "dark");
});

test("a theme the user toggled in the app wins over the viewer from then on", () => {
  const storage = memoryStorage();
  reconcileStoredTheme(storage, "light");
  storage.setItem("theme", "dark"); // what `d → m` writes
  assert.equal(reconcileStoredTheme(storage, "light"), "dark");
  assert.equal(reconcileStoredTheme(storage, "light"), "dark");
});

test("a theme stored before this logic existed counts as the user's choice", () => {
  const storage = memoryStorage();
  storage.setItem("theme", "light");
  assert.equal(reconcileStoredTheme(storage, "dark"), "light");
});
