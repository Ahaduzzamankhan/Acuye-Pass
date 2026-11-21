#!/usr/bin/env bash
# Register the Acuye Pass native messaging host for Chrome/Chromium on macOS.
#
# Usage: ./install-macos.sh <extension-id> [path-to-acuye-browser-host]
set -euo pipefail

HOST_NAME="com.fluxenite.acuyepass"
EXTENSION_ID="${1:-}"
HOST_PATH="${2:-}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../../.." && pwd)"

if [[ -z "$EXTENSION_ID" ]]; then
  echo "Usage: $0 <extension-id> [host-binary]" >&2
  exit 2
fi

if [[ -z "$HOST_PATH" ]]; then
  HOST_PATH="$repo_root/target/release/acuye-browser-host"
fi

if [[ ! -x "$HOST_PATH" ]]; then
  echo "The host binary is missing or not executable: $HOST_PATH" >&2
  echo "Build it first with: cargo build --release -p acuye-browser-host" >&2
  exit 1
fi

target_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$target_dir"

sed -e "s|__HOST_PATH__|$HOST_PATH|g" -e "s|__EXTENSION_ID__|$EXTENSION_ID|g" \
  "$here/manifest.template.json" > "$target_dir/$HOST_NAME.json"

echo "Installed $target_dir/$HOST_NAME.json"
echo "Host: $HOST_PATH"
echo "Reload the extension, then open its popup."
