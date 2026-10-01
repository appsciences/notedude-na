import { expect, test, type Page } from "@playwright/test";
import { NOTES, openArtifact, storedDocs } from "./harness.ts";

const app = (page: Page) => page.getByTestId("app");
const items = (page: Page) => page.getByTestId("list-pane").getByTestId("note-item");
const selected = (page: Page) => page.getByTestId("list-pane").locator("[data-selected='true']");
const idle = (page: Page) => expect(app(page)).toHaveAttribute("data-state", "idle");

async function writeNote(page: Page, text: string) {
  await page.keyboard.press("c");
  await expect(app(page)).toHaveAttribute("data-state", "editing");
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await idle(page);
}

test.describe("synced to the artifact database", () => {
  test.beforeEach(async ({ page }) => {
    await openArtifact(page);
    await idle(page);
    // A new account is greeted with one note; wait for it so later counts are stable.
    await expect(items(page)).toHaveCount(1);
  });

  test("a new viewer gets the welcome note and is told the notes are synced", async ({ page }) => {
    await expect(items(page).first()).toContainText("Greetings");
    await expect(page.getByTestId("account-header")).toContainText("synced");
  });

  test("c creates a note, Esc saves it, and it survives a reload", async ({ page }) => {
    await writeNote(page, "Groceries #home");
    await expect(items(page)).toHaveCount(2);
    await expect.poll(async () => Object.values(await storedDocs(page)).map((d) => d.content))
      .toContain("Groceries #home");
    expect(Object.keys(await storedDocs(page)).every((path) => path.startsWith(`${NOTES}/`))).toBe(true);

    await page.reload();
    await idle(page);
    await expect(items(page)).toHaveCount(2);
    await expect(page.getByTestId("list-pane")).toContainText("Groceries #home");
  });

  test("an untouched new note is discarded and never stored", async ({ page }) => {
    await page.keyboard.press("c");
    await page.keyboard.press("Escape");
    await idle(page);
    await expect(items(page)).toHaveCount(1);
    expect(Object.keys(await storedDocs(page))).toHaveLength(1);
  });

  test("j and k move the selection through the list", async ({ page }) => {
    await writeNote(page, "Second note");
    await expect(selected(page)).toContainText("Second note");
    await page.keyboard.press("j");
    await expect(selected(page)).toContainText("Greetings");
    await page.keyboard.press("k");
    await expect(selected(page)).toContainText("Second note");
  });

  test("/ searches by tag and Enter applies the filter", async ({ page }) => {
    await writeNote(page, "Groceries #home");
    await page.keyboard.press("/");
    await expect(app(page)).toHaveAttribute("data-state", "search");
    await page.keyboard.type("#home ");
    await page.keyboard.press("Enter");
    await idle(page);
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText("Groceries");
  });

  test("p pins the selected note and the pin is stored", async ({ page }) => {
    await page.keyboard.press("p");
    await expect(selected(page)).toHaveAttribute("data-pinned", "true");
    await expect.poll(async () => Object.values(await storedDocs(page))[0]?.pinned).toBe(true);
  });

  test("Enter edits the selected note and the change is stored", async ({ page }) => {
    await page.keyboard.press("Enter");
    await expect(app(page)).toHaveAttribute("data-state", "editing");
    await page.keyboard.type(" edited");
    await page.keyboard.press("Escape");
    await idle(page);
    await expect.poll(async () => Object.values(await storedDocs(page))[0]?.content).toContain(" edited");
  });

  test("? opens the shortcut list", async ({ page }) => {
    await page.keyboard.press("?");
    await expect(page.getByText("jump to note by position")).toBeVisible();
  });

  test("d then m switches theme, and the page behind the app follows", async ({ page }) => {
    const before = await app(page).getAttribute("data-theme");
    await page.keyboard.press("d");
    await page.keyboard.press("m");
    await expect(app(page)).not.toHaveAttribute("data-theme", before!);
    const expected = before === "dark" ? "rgb(255, 255, 255)" : "rgb(26, 26, 26)";
    await expect(page.locator("body")).toHaveCSS("background-color", expected);
  });
});

test.describe("viewer theme", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`first paint follows a ${scheme} viewer`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openArtifact(page);
      await expect(app(page)).toHaveAttribute("data-theme", scheme);
    });
  }
});

test("without the Claude runtime the app runs in demo mode on browser storage", async ({ page }) => {
  await openArtifact(page, { viewer: false });
  await idle(page);
  await expect(page.getByTestId("account-header")).toContainText("demo mode");
  await writeNote(page, "Local only");
  await page.reload();
  await idle(page);
  await expect(page.getByTestId("list-pane")).toContainText("Local only");
});

test("at phone width the list and the note share one pane", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await openArtifact(page);
  await idle(page);
  await expect(page.getByTestId("list-pane")).toBeVisible();
  await expect(page.getByTestId("content-pane")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
