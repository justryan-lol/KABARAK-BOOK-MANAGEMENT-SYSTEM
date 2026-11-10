#!/usr/bin/env bash
set -euo pipefail

# A Pages deployment must be explicitly pointed at its own approved Supabase
# project. Never silently fall back to a school/development project.
: "${SUPABASE_URL:?Set SUPABASE_URL to the approved backend for this deployment.}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY to the approved publishable/anon key.}"

case "$SUPABASE_URL" in
  https://*.supabase.co) ;;
  *) echo "Invalid Supabase URL: expected an https://*.supabase.co origin" >&2; exit 1 ;;
esac

rm -rf dist
mkdir -p dist

cp index.html app.js styles.css responsive.css spacious.css xlsx-export.js \
   manifest.json mhsk-crest.png sw.js dist/
cp _headers dist/_headers

# Make responsive.css available on the very first page load, even before a
# service worker is installed or controlling the browser. The service worker
# continues to precache/cache this separate asset for offline navigation.
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
  html = html.replace(baseLink, `${baseLink}\n    ${responsiveLink}`);
}
fs.writeFileSync(file, html);
if (!fs.existsSync('dist/responsive.css')) throw new Error('responsive.css was not copied to dist/.');
const spaciousLink = '<link rel="stylesheet" href="./spacious.css">';
if (html.split(spaciousLink).length !== 2) throw new Error('Expected exactly one spacious.css link in dist/index.html.');
if (!fs.existsSync('dist/spacious.css')) throw new Error('spacious.css was not copied to dist/.');
NODE

node - "$SUPABASE_URL" "$SUPABASE_ANON_KEY" <<'NODE'
const fs = require('node:fs');
const config = { url: process.argv[2], anonKey: process.argv[3] };
fs.writeFileSync('dist/config.js', `window.BOOKSTORE_CONFIG = ${JSON.stringify(config)};\n`);
NODE

echo "KBMS Cloudflare Pages build completed successfully."
