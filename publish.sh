#!/bin/bash
# Publish gmeet-unmirror to addons.mozilla.org (AMO).
#
# The FIRST submission of a new add-on is always manual (listing details + review
# on the Developer Hub), so this builds the package, opens the Hub, and reveals the
# artifact to upload. For LATER version updates of an add-on already on AMO, push a
# semver tag: `npm version patch && git push --follow-tags` — CI signs and uploads
# the new version automatically via release.yml.
set -euo pipefail
cd "$(dirname "$0")"

echo "→ Building the extension package…"
npm run build

ARTIFACT_DIR="$(pwd)/web-ext-artifacts"
echo "→ Opening the AMO Developer Hub."
echo "  Upload the package from: $ARTIFACT_DIR"
open "https://addons.mozilla.org/en-US/developers/addon/submit/upload-listed"
open "$ARTIFACT_DIR" 2>/dev/null || true
