#!/usr/bin/env bash
set -euo pipefail

# Use Cloudflare variables when available, with the
# existing KBMS Supabase project as a fallback.
SUPABASE_URL="${SUPABASE_URL:-https://neurpjthaftsroqbepzl.supabase.co}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-sb_publishable_Z88scaq89UKXQeecLZCZsQ_gZTaR16b}"

case "$SUPABASE_URL" in
  https://*.supabase.co) ;;
  *) echo "Invalid Supabase URL" >&2; exit 1 ;;
esac

rm -rf dist
mkdir -p dist

cp index.html app.js styles.css responsive.css xlsx-export.js \
   manifest.json mhsk-crest.png sw.js dist/

cp _headers dist/_headers

node - "$SUPABASE_URL" "$SUPABASE_ANON_KEY" <<'NODE'
const fs = require('node:fs');

const config = {
  url: process.argv[2],
  anonKey: process.argv[3]
};

fs.writeFileSync(
  'dist/config.js',
  `window.BOOKSTORE_CONFIG = ${JSON.stringify(config)};\n`
);
NODE

echo "KBMS build completed successfully."
