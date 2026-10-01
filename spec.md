# notedude-na spec

notedude as a Claude artifact: the keyboard-driven notes app from `notedude2`, published as
a single page on claude.ai.

## What it is

- The same app as the web version: same screens, same shortcuts, same Markdown handling.
- One HTML file, `dist/notedude.html`, built by `npm run build` and published with the
  `mcp` capability, declaring the `NoteDude` connector and the four tools below.

## Reuse

| Piece | Source | How it is used |
| --- | --- | --- |
| App behaviour and keyboard handling | `notedude2/src/components/App.tsx` | Bundled unmodified |
| Components and design tokens | `notedude2/packages/ui/src` | Bundled unmodified |
| Storage port (`NoteRepository`) | `notedude_core` | Implemented by `src/mcp-repository.ts` |
| Note storage | `notedude_mcp` service | Called through the viewer's `NoteDude` connector |
| Firestore layer | `notedude2/src/lib/notes.ts` | Replaced at build time by `src/notes.ts` |
| Sign-in page | `notedude2/src/app/page.tsx` | Replaced by `src/main.tsx` |

The build reads whatever is checked out in the sibling folders, so the artifact tracks the
web app. If the web app's notes module gains an export that `src/notes.ts` lacks, the build
fails rather than shipping a page with a missing function.

Next.js is not involved: the web app is a static export and its app code imports nothing
from Next. React 18.3.1 is loaded from cdnjs, the newest release with a browser build there.

## Storage

Every note operation goes through the NoteDude MCP service (`notedude_mcp`), so the artifact
shows the same notes as the web app. An artifact cannot open network connections itself: it
calls the connector the viewer has added in Claude, named exactly `NoteDude`, with the
viewer's credentials.

### Tool contract

| Tool | Input | Used for |
| --- | --- | --- |
| `list_notes` | `limit` (100), `include_archived` (true) | Loading and refreshing the list |
| `save_note` | `id`, `content`, `pinned`, `tag_pinned`, `created_at` (ISO 8601) | Creating a note, and saving edits |
| `update_note` | `id` plus any of `content`, `pinned`, `tag_pinned` | Pin, tag-pin, archive, task move |
| `delete_note` | `id` | Permanently deleting a note |

- `list_notes` returns `{ notes: [...], has_more? }`. Each note carries `id`, `content`,
  `pinned`, `tag_pinned`, `created_at` and `updated_at` (ISO 8601 or Unix milliseconds).
- `save_note` creates or fully replaces the note with that id. `update_note` changes only
  the fields sent and fails if the note does not exist. The service stamps `updated_at`.
- As of this writing the service has only `list_notes` (capped at 100 notes). Until the
  three write tools exist, the artifact loads notes but every save is refused, and says so.

### Behaviour

- Writes to one note run one at a time, in the order the app issued them. A failed write is
  not retried, because the service may have applied it.
- The list is refetched after every write and every 30 seconds. Changes made elsewhere
  appear on the next refetch, not instantly.
- A change made here keeps showing even if a list fetched just before it arrives late. It
  yields once a list agrees with it, or after 60 seconds.
- A note that was created and never typed in is not stored.
- An account with no notes gets one welcome note, as in the web app.
- When the account holds more notes than one list returns, the header says only the most
  recent 100 are shown.

## Modes

- **Synced**: the `NoteDude` connector is connected. The header reads "synced with NoteDude".
- **Demo**: no Claude runtime, or the connector is missing or needs reconnecting. The app's
  own demo mode is used, notes stay in that browser, and the header says how to sync.
- A failed save or refresh replaces the header text until the next one succeeds. The wording
  depends on the cause: reconnect the connector, add it, not allowed for this page, blocked
  by the organization, refused by the service, or unreachable.

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

- `npm run test:unit`: connector adapter and theme logic, against an in-memory connector
  that follows the tool contract.
- `npm run test:e2e`: the built page in headless Chromium with a stand-in for the Claude
  runtime, covering create, edit, pin, search, navigation, reload, theme, demo mode, a
  missing connector, a connector without write tools, and phone width. `npm run test:e2e:headed` opens a window.
