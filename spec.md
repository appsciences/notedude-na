# notedude-na spec

notedude as a Claude artifact: the keyboard-driven notes app from `notedude2`, published as
a single page on claude.ai.

## What it is

- The same app as the web version: same screens, same shortcuts, same Markdown handling.
- One HTML file, `dist/notedude.html`, built by `npm run build` and published with the
  capabilities `db` and `user`.

## Reuse

| Piece | Source | How it is used |
| --- | --- | --- |
| App behaviour and keyboard handling | `notedude2/src/components/App.tsx` | Bundled unmodified |
| Components and design tokens | `notedude2/packages/ui/src` | Bundled unmodified |
| Storage port (`NoteRepository`) | `notedude_core` | Implemented by `src/artifact-repository.ts` |
| Firestore layer | `notedude2/src/lib/notes.ts` | Replaced at build time by `src/notes.ts` |
| Sign-in page | `notedude2/src/app/page.tsx` | Replaced by `src/main.tsx` |

The build reads whatever is checked out in the sibling folders, so the artifact tracks the
web app. If the web app's notes module gains an export that `src/notes.ts` lacks, the build
fails rather than shipping a page with a missing function.

Next.js is not involved: the web app is a static export and its app code imports nothing
from Next. React 18.3.1 is loaded from cdnjs, the newest release with a browser build there.

## Storage

- Notes are documents at `data/users/<viewer id>/notedude/notes/<note id>` in the artifact's
  database. That subtree is private to each viewer, including from the artifact's owner.
- A document holds `content`, `pinned`, `tagPinned`, `createdAt`, `updatedAt`. `updatedAt`
  is the writer's clock at the time of the write.
- Writes to one note run one at a time, in the order the app issued them.
- A note that was created and never typed in is not stored.
- A first-time viewer gets one welcome note.
- These notes are separate from the notes in the web app's Firebase account. An artifact
  cannot reach Firebase.

## Modes

- **Synced**: the viewer is signed in and the artifact database is available. The header
  reads "synced · private to you".
- **Demo**: no database or no viewer identity (for example the file opened on its own).
  The app's own demo mode is used and notes stay in that browser. The header says so.
- A failed save replaces the header text with the reason until a later save succeeds.

## Keyboard

- All shortcuts are the web app's. They reach the page only while the artifact frame has
  focus, so until the viewer clicks, the header reads "click here to use the keyboard".

## Theme

- First paint follows the Claude viewer's theme (its explicit setting, else the system's).
- Once the user toggles with `d → m`, that choice is kept for that browser.

## Known differences from the web app

- No Google sign-in and no log out.
- The donate and report-an-issue shortcuts open a new tab or mail link, which the artifact
  viewer may block.
- No offline install and no share target.

## Tests

- `npm run test:unit`: storage adapter and theme logic.
- `npm run test:e2e`: the built page in headless Chromium with a stand-in for the Claude
  runtime, covering create, edit, pin, search, navigation, reload, theme, demo mode and
  phone width. `npm run test:e2e:headed` opens a window.
