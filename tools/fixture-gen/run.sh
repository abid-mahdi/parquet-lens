#!/usr/bin/env bash
# Regenerates the parquet fixtures with real Spark. Only needed when changing
# fixtures; the small ones are committed so tests and CI need no JVM.
set -euo pipefail

JAVA_11="$(/usr/libexec/java_home -v 11 2>/dev/null || true)"
if [[ -z "$JAVA_11" ]]; then
  echo "Spark 3.3.2 needs Java 8, 11 or 17. Install a JDK 11 and retry." >&2
  exit 1
fi

cd "$(dirname "$0")"
JAVA_HOME="$JAVA_11" sbt -batch "run ${1:-../../fixtures} ${2:-}"
