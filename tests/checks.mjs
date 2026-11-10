import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");
const requiredFiles = [
  "index.html", "styles.css", "responsive.css", "app.js", "config.js",
  "sw.js", "manifest.json", "xlsx-export.js", "scripts/build-cloudflare.sh",
];
for (const file of requiredFiles) {
  assert.ok(existsSync(resolve(root, file)), `Required application asset is missing: ${file}`);
}

const html = read("index.html");
const css = read("styles.css");
const responsiveCss = read("responsive.css");
const config = read("config.js");
const serviceWorker = read("sw.js");
const buildScript = read("scripts/build-cloudflare.sh");
const manifest = JSON.parse(read("manifest.json"));

assert.match(html, /<html\s+lang="en"/i, "The document should declare its language.");
assert.match(html, /id="app-content"[^>]*tabindex="-1"/, "Workspace content should be programmatically focusable.");
assert.match(html, /id="mobile-nav-toggle"[^>]*aria-label=/, "The mobile navigation control needs an accessible name.");
assert.match(html, /id="mobile-nav-backdrop"[^>]*aria-label=/, "The mobile navigation backdrop needs an accessible name.");
assert.match(css, /:focus-visible/, "Keyboard focus indicators must remain available.");
assert.match(css, /prefers-reduced-motion:\s*reduce/, "Base styles must respect reduced-motion preferences.");
assert.match(responsiveCss, /scrollbar-width:\s*thin/, "Scrollable regions must keep discoverable scrollbars.");
assert.match(responsiveCss, /html\s*\{[^}]*overflow-y:\s*auto\s*!important/s, "The document must retain native vertical scrolling.");
assert.match(responsiveCss, /html::\-webkit-scrollbar\s*\{[^}]*width:\s*14px/s, "The main vertical scrollbar must be wide enough to grab reliably.");
assert.match(responsiveCss, /\.table-wrap\s*\{[^}]*overflow:\s*auto/s, "Tables must retain a scrollable overflow container.");
assert.match(responsiveCss, /\.public-home\s*\{[^}]*height:\s*auto\s*!important/s, "The public homepage must not clip content below one viewport.");
assert.match(responsiveCss, /max-width:\s*360px/, "The layout needs a narrow-phone breakpoint.");
assert.match(responsiveCss, /max-width:\s*700px/, "The layout needs a mobile breakpoint.");
assert.match(responsiveCss, /prefers-reduced-motion:\s*reduce/, "Responsive motion must respect reduced-motion preferences.");

const responsiveStylesheetLink = '<link rel="stylesheet" href="./responsive.css">';
assert.equal((html.match(/<link\b[^>]*href=["']\.\/responsive\.css["']/gi) || []).length, 1,
  "Source HTML must link responsive.css exactly once for first-load visitors.");
assert.ok(html.indexOf('<link rel="stylesheet" href="./styles.css">') < html.indexOf(responsiveStylesheetLink),
  "Responsive styles should load after the base stylesheet.");
assert.ok(html.includes('<link rel="stylesheet" href="./spacious.css">'), "The roomier luxury-minimal stylesheet must be linked.");
assert.match(buildScript, /responsiveLink\s*=\s*'<link rel="stylesheet" href="\.\/responsive\.css">'/,
  "The production build should preserve or inject the responsive stylesheet link.");
assert.match(buildScript, /SUPABASE_URL:\?Set SUPABASE_URL/, "Builds must require an explicit backend URL, not silently use a project fallback.");
assert.match(buildScript, /SUPABASE_ANON_KEY:\?Set SUPABASE_ANON_KEY/, "Builds must require an explicit publishable key.");
assert.match(buildScript, /cp index\.html app\.js styles\.css responsive\.css spacious\.css/, "The build must package the spacious stylesheet.");
assert.match(serviceWorker, /"\.\/spacious\.css"/, "The service worker must precache the spacious stylesheet.");
assert.match(serviceWorker, /mhsk-kbms-v41/, "The service-worker cache version should match the current release.");
assert.match(serviceWorker, /explicitlyLinked/, "The worker must avoid duplicate stylesheet injection in built output.");
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "The installable app manifest needs an icon.");
assert.match(config, /window\.BOOKSTORE_CONFIG\s*=/, "Runtime configuration must be initialized.");

for (const [, asset] of html.matchAll(/\b(?:src|href)=["'](\.[^"']*)["']/g)) {
  const pathname = asset.split(/[?#]/, 1)[0];
  if (pathname === "./") continue;
  assert.ok(existsSync(resolve(root, pathname)), `HTML references a missing local asset: ${asset}`);
}
const precache = serviceWorker.match(/const\s+APP_ASSETS\s*=\s*\[([\s\S]*?)\];/);
assert.ok(precache, "The service worker should declare an application precache list.");
for (const [, asset] of precache[1].matchAll(/["'](\.[^"']*)["']/g)) {
  const pathname = asset.split(/[?#]/, 1)[0];
  if (pathname === "./") continue;
  assert.ok(existsSync(resolve(root, pathname)), `Service worker precaches a missing asset: ${asset}`);
}

for (const file of ["index.html", "app.js", "config.js"]) {
  assert.doesNotMatch(read(file), /(?:service[_-]?role|supabase_service_role_key)/i,
    `A service-role credential reference must not appear in client code (${file}).`);
}

console.log("KBMS static regression checks passed.");
console.log("These checks do not replace browser, PostgreSQL/RLS, or deployed-role acceptance tests.");
