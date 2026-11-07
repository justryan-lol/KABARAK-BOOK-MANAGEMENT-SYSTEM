import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");
const requiredFiles = [
  "index.html",
  "styles.css",
  "responsive.css",
  "app.js",
  "config.js",
  "sw.js",
  "manifest.json",
  "xlsx-export.js",
];

for (const file of requiredFiles) {
  assert.ok(existsSync(resolve(root, file)), `Required application asset is missing: ${file}`);
}

const html = read("index.html");
const css = read("styles.css");
const responsiveCss = read("responsive.css");
const app = read("app.js");
const config = read("config.js");
const serviceWorker = read("sw.js");
const buildScript = read("scripts/build-cloudflare.sh");
const manifest = JSON.parse(read("manifest.json"));

assert.match(html, /<html\s+lang="en"/i, "The document should declare its language.");
assert.match(html, /id="app-content"[^>]*tabindex="-1"/, "The workspace content should be programmatically focusable.");
assert.match(html, /id="mobile-nav-toggle"[^>]*aria-label=/, "The mobile navigation control needs an accessible name.");
assert.match(html, /id="mobile-nav-backdrop"[^>]*aria-label=/, "The mobile navigation backdrop needs an accessible name.");
assert.match(css, /:focus-visible/, "Keyboard focus indicators must remain available.");
assert.match(css, /prefers-reduced-motion:\s*reduce/, "Reduced-motion preferences must be respected.");
assert.match(responsiveCss, /scrollbar-width:\s*thin/, "Scrollable regions must keep discoverable scrollbars.");
assert.match(responsiveCss, /\.table-wrap[\s\S]*overflow:\s*auto/, "Tables must retain a scrollable overflow container.");
assert.match(responsiveCss, /\.public-home[\s\S]*height:\s*auto\s*!important/, "The public homepage must not clip content below one viewport.");
assert.match(responsiveCss, /max-width:\s*360px/, "The layout needs a narrow-phone breakpoint.");
assert.match(responsiveCss, /max-width:\s*700px/, "The layout needs a mobile breakpoint.");
assert.match(responsiveCss, /prefers-reduced-motion:\s*reduce/, "Responsive motion must respect reduced-motion preferences.");
assert.match(serviceWorker, /responsive\.css/, "The service worker must load the responsive refinement stylesheet.");
assert.match(serviceWorker, /mhsk-kbms-v33/, "The service-worker cache must be bumped when shipped assets change.");
assert.match(buildScript, /responsive\.css/, "Cloudflare build output must include the responsive stylesheet.");
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "The installable app manifest needs an icon.");
assert.match(config, /window\.BOOKSTORE_CONFIG\s*=/, "The public runtime configuration must be initialized.");

// Ensure local files referenced by the document are actually packaged. Ignore
// external URLs, fragment-only links, and application routes with query strings.
for (const [, asset] of html.matchAll(/\b(?:src|href)=["'](\.[^"']*)["']/g)) {
  const pathname = asset.split(/[?#]/, 1)[0];
  if (pathname === "./") continue;
  assert.ok(existsSync(resolve(root, pathname)), `HTML references a missing local asset: ${asset}`);
}

// Keep the service-worker precache list synchronized with files shipped at root.
const precache = serviceWorker.match(/const\s+APP_ASSETS\s*=\s*\[([\s\S]*?)\];/);
assert.ok(precache, "The service worker should declare its application precache list.");
for (const [, asset] of precache[1].matchAll(/["'](\.[^"']*)["']/g)) {
  const pathname = asset.split(/[?#]/, 1)[0];
  if (pathname === "./") continue;
  assert.ok(existsSync(resolve(root, pathname)), `Service worker precaches a missing asset: ${asset}`);
}

// Secret service-role credentials must never be embedded in browser-delivered code.
for (const file of ["index.html", "app.js", "config.js"]) {
  assert.doesNotMatch(read(file), /(?:service[_-]?role|supabase_service_role_key)/i,
    `A service-role credential reference must not appear in client code (${file}).`);
}

console.log("KBMS static regression checks passed.");
console.log("Note: these checks do not replace browser, PostgreSQL/RLS, or deployed-role acceptance tests.");
