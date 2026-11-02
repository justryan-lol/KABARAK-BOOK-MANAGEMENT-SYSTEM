#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_URL:?Set SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY}"

case "$SUPABASE_URL" in
  https://*.supabase.co) ;;
  *) echo "SUPABASE_URL must be an HTTPS Supabase project URL." >&2; exit 1 ;;
esac

rm -rf dist
mkdir -p dist
cp index.html app.js styles.css xlsx-export.js manifest.json mhsk-crest.png sw.js dist/
cp _headers dist/_headers

SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" node <<'NODE'
const fs = require('node:fs');
const config = {
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
};
fs.writeFileSync('dist/config.js', `window.BOOKSTORE_CONFIG = ${JSON.stringify(config)};\n`);
NODE

echo "KBMS Cloudflare build completed."
