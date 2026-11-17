#!/usr/bin/env bash
set -euo pipefail

# Cloudflare Pages build variables override the repository's public runtime
# config when supplied. If Pages does not expose build variables to the build
# shell, preserve and validate the already committed config.js instead.
if [[ -n "${SUPABASE_URL:-}" || -n "${SUPABASE_ANON_KEY:-}" ]]; then
  : "${SUPABASE_URL:?Set SUPABASE_URL when overriding the repository runtime config.}"
  : "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY when overriding the repository runtime config.}"
  CONFIG_MODE="environment"
else
  CONFIG_MODE="repository"
fi

rm -rf dist
mkdir -p dist

cp index.html app.js styles.css responsive.css spacious.css xlsx-export.js \
   manifest.json mhsk-crest.png sw.js dist/
cp _headers dist/_headers

# Keep first-load responsive styling deterministic; do not depend on the
# service worker being installed before the page is styled.
node <<'NODE'
const fs = require('node:fs');
const file = 'dist/index.html';
let html = fs.readFileSync(file, 'utf8');
const responsiveLink = '<link rel="stylesheet" href="./responsive.css">';
if (!html.includes(responsiveLink)) {
  const baseLink = '<link rel="stylesheet" href="./styles.css">';
  if (html.split(baseLink).length !== 2) {
    throw new Error('Expected exactly one styles.css link in index.html.');
  }
  html = html.replace(baseLink, `${baseLink}\\n    ${responsiveLink}`);
}
fs.writeFileSync(file, html);
if (!fs.existsSync('dist/responsive.css')) throw new Error('responsive.css was not copied to dist/.');
const spaciousLink = '<link rel="stylesheet" href="./spacious.css">';
if (html.split(spaciousLink).length !== 2) throw new Error('Expected exactly one spacious.css link in dist/index.html.');
if (!fs.existsSync('dist/spacious.css')) throw new Error('spacious.css was not copied to dist/.');
NODE

if [[ "$CONFIG_MODE" == "environment" ]]; then
  case "$SUPABASE_URL" in
    https://*.supabase.co) ;;
    *) echo "Invalid Supabase URL: expected an https://*.supabase.co origin" >&2; exit 1 ;;
  esac
  node - "$SUPABASE_URL" "$SUPABASE_ANON_KEY" <<'NODE'
const fs = require('node:fs');
const config = { url: process.argv[2], anonKey: process.argv[3] };
if (!config.anonKey || /service[_-]?role/i.test(config.anonKey)) {
  throw new Error('A public Supabase publishable/anon key is required; service-role keys are forbidden.');
}
fs.writeFileSync('dist/config.js', `window.BOOKSTORE_CONFIG = ${JSON.stringify(config)};\\n`);
NODE
  echo "KBMS build completed using Cloudflare build variables."
else
  # config.js is already loaded by index.html and contains public client
  # configuration. Validate it and copy it unchanged rather than failing
  # merely because Pages did not expose dashboard variables to the build.
  node <<'NODE'
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync('config.js', 'utf8'), sandbox, { timeout: 1000 });
const config = sandbox.window.BOOKSTORE_CONFIG;
if (!config || !/^https:\/\/[^/]+\.supabase\.co$/.test(config.url || '') ||
    typeof config.anonKey !== 'string' || !config.anonKey.trim() ||
    /service[_-]?role/i.test(config.anonKey)) {
  throw new Error('Repository config.js must contain a valid Supabase URL and public anon/publishable key (never a service-role key).');
}
fs.copyFileSync('config.js', 'dist/config.js');
NODE
  echo "KBMS build completed using the validated repository config.js."
fi
