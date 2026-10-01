# notedude-na

notedude as a Claude artifact. See [spec.md](spec.md) for behaviour.

## Layout

This repo holds only the artifact-specific code. The app itself comes from two sibling
checkouts, expected next to this folder:

```
dev/
  notedude2/       the web app (UI and behaviour)
  notedude_core/   the shared domain core (storage port)
  notedude-na/     this repo
```

Set `NOTEDUDE2_DIR` and `NOTEDUDE_CORE_DIR` if they live elsewhere.

## Build and publish

```bash
npm install
npm run build
```

This writes `dist/notedude.html`. Publish that file as an artifact with the capability

```json
{"mcp": {"servers": [{"server": "NoteDude", "tools": ["list_notes", "save_note", "update_note", "delete_note"]}]}}
```

Notes sync once the `notedude_mcp` service is added in Claude as a connector named exactly
`NoteDude`; until then the artifact runs in demo mode. `dist/` is not committed: it contains bundled `notedude2` source.

## Test

```bash
npm test
```

Runs the unit tests, builds, then runs the browser tests headless.
