#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
JQ_LSP_DIR="$ROOT_DIR/jq-lsp"
BIN_DIR="$ROOT_DIR/src-tauri/binaries"

if ! command -v go >/dev/null 2>&1; then
	echo "Error: Go is required to build jq-lsp sidecar but was not found in PATH." >&2
	exit 1
fi

if [ ! -d "$JQ_LSP_DIR" ]; then
	echo "Error: jq-lsp source directory not found at $JQ_LSP_DIR" >&2
	exit 1
fi

mkdir -p "$BIN_DIR"

OS="$(uname -s)"
ARCH="$(uname -m)"

TARGET=""
GOOS=""
GOARCH=""
EXT=""

case "$OS" in
Linux)
	GOOS="linux"
	case "$ARCH" in
	x86_64)
		GOARCH="amd64"
		TARGET="x86_64-unknown-linux-gnu"
		;;
	aarch64 | arm64)
		GOARCH="arm64"
		TARGET="aarch64-unknown-linux-gnu"
		;;
	*)
		echo "Error: unsupported Linux architecture '$ARCH'" >&2
		exit 1
		;;
	esac
	;;
Darwin)
	GOOS="darwin"
	case "$ARCH" in
	arm64)
		GOARCH="arm64"
		TARGET="aarch64-apple-darwin"
		;;
	x86_64)
		GOARCH="amd64"
		TARGET="x86_64-apple-darwin"
		;;
	*)
		echo "Error: unsupported macOS architecture '$ARCH'" >&2
		exit 1
		;;
	esac
	;;
MINGW* | MSYS* | CYGWIN*)
	GOOS="windows"
	GOARCH="amd64"
	TARGET="x86_64-pc-windows-msvc"
	EXT=".exe"
	;;
*)
	echo "Error: unsupported operating system '$OS'" >&2
	exit 1
	;;
esac

OUTPUT="$BIN_DIR/jq-lsp-$TARGET$EXT"

echo "Building jq-lsp sidecar for $TARGET -> $OUTPUT"
(
	cd "$JQ_LSP_DIR"
	GOOS="$GOOS" GOARCH="$GOARCH" go build -o "$OUTPUT" .
)

chmod +x "$OUTPUT" 2>/dev/null || true
echo "Built jq-lsp sidecar: $OUTPUT"
