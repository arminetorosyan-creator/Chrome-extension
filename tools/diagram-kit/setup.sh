#!/usr/bin/env bash
# One-time setup for the diagram kit: npm deps, PlantUML jar, headless Chromium.
# Requires: node >= 18, java >= 11, curl. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

PLANTUML_VERSION=1.2025.4
PLANTUML_SHA256=cb8bca6301c114eb66c6e6c55b4cd1962f380616c622e964596a24f94246bc41
JAR=vendor/plantuml.jar

command -v node >/dev/null || { echo "node is required"; exit 1; }
command -v java >/dev/null || { echo "java is required (for PlantUML)"; exit 1; }

npm ci --no-audit --no-fund

if [ ! -s "$JAR" ] || ! echo "$PLANTUML_SHA256  $JAR" | sha256sum -c --quiet 2>/dev/null; then
  mkdir -p vendor
  curl -fL -o "$JAR" "https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/plantuml-mit-${PLANTUML_VERSION}.jar"
  echo "$PLANTUML_SHA256  $JAR" | sha256sum -c --quiet || { echo "PlantUML checksum mismatch"; rm -f "$JAR"; exit 1; }
fi

# Chromium: reuse a pre-installed one (PLAYWRIGHT_BROWSERS_PATH) or download.
if ! ls "${PLAYWRIGHT_BROWSERS_PATH:-/nonexistent}"/chromium-*/ >/dev/null 2>&1; then
  npx playwright-core install chromium
fi
echo "diagram-kit ready."
