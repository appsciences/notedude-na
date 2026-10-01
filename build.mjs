// Builds dist/notedude.html: the notedude web app as one page, ready to publish as a
// Claude artifact.
//
// The UI is not copied or forked. `App.tsx` and the @notedude/ui package are bundled
// straight from a sibling checkout of notedude2; the only substitution is its Firestore
// module, which is swapped for src/notes.ts. React comes from the page's CDN <script> tags.
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const notedude2 = resolve(here, process.env.NOTEDUDE2_DIR ?? "../notedude2");
const core = resolve(here, process.env.NOTEDUDE_CORE_DIR ?? "../notedude_core");

const app = resolve(notedude2, "src/components/App.tsx");
const sources = {
  "notedude2-app": app,
  "@notedude/ui": resolve(notedude2, "packages/ui/src/index.ts"),
  "@notedude/core": resolve(core, "src/index.ts"),
};
for (const [name, file] of Object.entries(sources)) {
  if (!existsSync(file)) {
    console.error(`Cannot find ${name} at ${file}.\nSet NOTEDUDE2_DIR / NOTEDUDE_CORE_DIR to the checkouts.`);
    process.exit(1);
  }
}

// React 18 has no ESM build on the allowed CDN, so the bundle reads the UMD globals.
const reactGlobals = {
  react: "module.exports = window.React;",
  "react-dom/client": "module.exports = window.ReactDOM;",
  // The automatic JSX runtime, expressed with createElement. `jsxs` marks static children,
  // which are spread so React does not ask for keys on them.
  "react/jsx-runtime": `
    const React = window.React;
    const withKey = (props, key) => (key === undefined ? props : { ...props, key });
    exports.Fragment = React.Fragment;
    exports.jsx = (type, props, key) => React.createElement(type, withKey(props, key));
    exports.jsxs = (type, { children, ...props }, key) =>
      React.createElement(type, withKey(props, key), ...children);
  `,
};

const artifactPlugin = {
  name: "notedude-artifact",
  setup(b) {
    b.onResolve({ filter: /^(react|react-dom\/client|react\/jsx-runtime)$/ }, (args) => ({
      path: args.path,
      namespace: "react-global",
    }));
    b.onLoad({ filter: /.*/, namespace: "react-global" }, (args) => ({
      contents: reactGlobals[args.path],
      loader: "js",
    }));
    // The one seam: the web app's Firestore module becomes the artifact store.
    b.onResolve({ filter: /^\.\.\/lib\/notes$/ }, (args) =>
      args.importer === app ? { path: resolve(here, "src/notes.ts") } : undefined,
    );
  },
};

const result = await build({
  entryPoints: [resolve(here, "src/main.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  alias: sources,
  plugins: [artifactPlugin],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

// A literal "</script" inside the bundle would end the inline script early.
const bundle = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const template = readFileSync(resolve(here, "src/page.html"), "utf8");
const marker = "/*__NOTEDUDE_BUNDLE__*/";
if (!template.includes(marker)) throw new Error(`src/page.html is missing ${marker}`);
const html = template.replace(marker, () => bundle);

mkdirSync(resolve(here, "dist"), { recursive: true });
const out = resolve(here, "dist/notedude.html");
writeFileSync(out, html);
console.log(`dist/notedude.html  ${(html.length / 1024).toFixed(1)} KB`);
