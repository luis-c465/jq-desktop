# Plan: Integrate jq-lsp with Hover and Autocomplete

---

## Section 1: High-Level Overview

### 1.1 — Goal Statement

Integrate the jq-lsp language server (already present in the repo at `jq-lsp/`) into the jq-desktop Tauri application to provide real-time **hover documentation**, **autocomplete suggestions**, and **inline diagnostics** for jq expressions in the query editor. This requires replacing the current plain `<textarea>` with CodeMirror 6, bundling jq-lsp as a Tauri sidecar binary, and building a Rust-side LSP client that manages the jq-lsp process and JSON-RPC protocol.

### 1.2 — Approach Summary

**Architecture:**
```
┌─────────────────────────────────────────────────┐
│  Frontend (React + CodeMirror 6)                │
│  ┌───────────────────────────────────────────┐  │
│  │  CodeMirror 6 Editor                      │  │
│  │  + @codemirror/autocomplete               │  │
│  │  + @codemirror/lint                        │  │
│  │  + hoverTooltip                            │  │
│  └───────────────────────────────────────────┘  │
│         │ Tauri invoke() commands                │
└─────────┼───────────────────────────────────────┘
          ▼
┌─────────────────────────────────────────────────┐
│  Rust Backend (Tauri)                           │
│  ┌───────────────────────────────────────────┐  │
│  │  LspClient module                         │  │
│  │  - Spawns jq-lsp sidecar                  │  │
│  │  - JSON-RPC framing (Content-Length)       │  │
│  │  - Request/response routing                │  │
│  │  - Exposes: lsp_hover, lsp_complete,      │  │
│  │    lsp_did_change, lsp_initialize          │  │
│  └───────────────────────────────────────────┘  │
│         │ stdin/stdout (JSON-RPC over stdio)     │
└─────────┼───────────────────────────────────────┘
          ▼
┌─────────────────────────────────────────────────┐
│  jq-lsp (Go binary, Tauri sidecar)             │
│  - Hover: textDocument/hover                    │
│  - Autocomplete: textDocument/completion        │
│  - Diagnostics: textDocument/publishDiagnostics │
│  - Syntax checking, go-to-definition            │
└─────────────────────────────────────────────────┘
```

**Key technology choices:**
- **CodeMirror 6** replaces the `<textarea>` — it's the standard code editor for web apps with native support for autocomplete, hover tooltips, and linting/diagnostics.
- **`codemirror-languageservice`** (by remcohaszing) is used as the CodeMirror-LSP bridge — it's transport-agnostic, meaning we can route LSP calls through Tauri `invoke()` commands rather than needing a WebSocket server. This is the ideal fit for a Tauri desktop app.
- **Tauri sidecar** bundles the pre-compiled jq-lsp Go binary with the app, using `tauri-plugin-shell` for process management.
- **Rust LSP client** manages the jq-lsp process lifecycle, handles JSON-RPC framing (Content-Length headers), and exposes clean typed Tauri commands to the frontend.

### 1.3 — Decisions Log

- **Decision:** Use CodeMirror 6 instead of keeping the textarea.
  - **Alternatives considered:** Keep textarea + build custom hover/autocomplete UI; use Monaco editor.
  - **Rationale:** CodeMirror 6 is lightweight, modular, has excellent LSP integration packages, and is the standard for embedded code editors. Monaco is heavier and designed for VS Code-like experiences. A textarea cannot support inline diagnostics, hover tooltips, or autocomplete dropdowns without reimplementing an editor.

- **Decision:** Use `codemirror-languageservice` as the CodeMirror-LSP bridge.
  - **Alternatives considered:** `@marimo-team/codemirror-languageserver` (WebSocket-based), `codemirror-languageserver` (WebSocket-based), custom implementation.
  - **Rationale:** `codemirror-languageservice` is transport-agnostic — you provide your own `doHover`, `doComplete`, and `doDiagnostics` functions. This lets us route LSP calls through Tauri `invoke()` commands without needing a WebSocket proxy server. The WebSocket-based packages would require running a WebSocket server just to bridge to stdio, adding unnecessary complexity.

- **Decision:** Rust backend manages the jq-lsp process (not the frontend).
  - **Alternatives considered:** Frontend manages via `@tauri-apps/plugin-shell`; hybrid passthrough.
  - **Rationale:** JSON-RPC over stdio requires careful byte-level framing (Content-Length headers). Rust is better suited for this low-level I/O. Keeping process management in Rust also means the frontend doesn't need shell permissions, and the LSP lifecycle is tied to the app lifecycle naturally.

- **Decision:** Bundle jq-lsp as a Tauri sidecar.
  - **Alternatives considered:** Expect system-installed jq-lsp; embed as a Tauri resource.
  - **Rationale:** Sidecar is the standard Tauri pattern for bundling external binaries. It handles platform-specific binary naming and is well-supported by the build system.

- **Decision:** Replace jaq-based validation with LSP diagnostics.
  - **Alternatives considered:** Keep both; only add hover/autocomplete.
  - **Rationale:** jq-lsp provides richer diagnostics (missing functions, missing bindings, syntax errors with precise positions) than the current jaq validation. Using LSP diagnostics eliminates the 300ms debounce + separate validation call pattern and provides a unified error reporting pipeline.

### 1.4 — Assumptions & Open Questions

**Assumptions:**
- Go is available in the build environment to compile jq-lsp. (The `jq-lsp/` directory is a full Go module.)
- The jq-lsp binary can be cross-compiled for all target platforms (Linux x86_64, macOS aarch64/x86_64, Windows x86_64).
- The jq-lsp process is lightweight enough to keep running for the lifetime of the app (it is — it's a simple stdio server).
- A single jq-lsp instance is sufficient (we only have one editor).

**Open Questions:**
- Should the jq-lsp process be started eagerly on app launch or lazily when the first query is typed? (Plan assumes eager start for simplicity.)
- Should we support the `textDocument/definition` (go-to-definition) feature in the future? (Plan focuses on hover + autocomplete + diagnostics but the architecture supports adding it later.)

### 1.5 — Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| jq-lsp process crashes or hangs | Low | Medium | Implement health check and auto-restart in the Rust LSP client. Set timeouts on all LSP requests. |
| JSON-RPC framing bugs (partial reads, split messages) | Medium | High | Use a proper buffered reader that accumulates bytes until Content-Length is satisfied. Write thorough unit tests for the framing layer. |
| CodeMirror 6 migration breaks existing query execution flow | Low | Medium | The `useQueryExecution` hook is decoupled from the editor component. Only the editor UI changes; the execution flow (Ctrl+Enter → run query) remains the same. |
| Cross-compilation of jq-lsp fails for some platforms | Medium | Medium | Start with the host platform only. Add cross-compilation in CI later. Use `go build` with `GOOS`/`GOARCH` env vars. |
| jq-lsp returns different error positions than jaq | Low | Low | LSP diagnostics replace jaq validation entirely, so there's no conflict. |
| `codemirror-languageservice` package doesn't handle jq-lsp's response format | Low | Medium | jq-lsp follows the LSP spec. The test data confirms standard `textDocument/hover` and `textDocument/completion` response shapes. |

### 1.6 — Step Sequence Overview

1. **Add dependencies** — Install CodeMirror 6, codemirror-languageservice, and tauri-plugin-shell
2. **Build jq-lsp sidecar binary** — Add build script and Tauri sidecar configuration
3. **Implement Rust LSP client** — JSON-RPC framing, process management, and Tauri commands
4. **Create CodeMirror 6 editor component** — Replace textarea with CodeMirror, basic jq syntax highlighting
5. **Wire up LSP hover** — Connect CodeMirror hover tooltips to the Rust LSP client
6. **Wire up LSP autocomplete** — Connect CodeMirror autocompletion to the Rust LSP client
7. **Wire up LSP diagnostics** — Replace jaq validation with LSP publishDiagnostics
8. **Update QueryEditor and AppShell** — Swap the old textarea-based editor for the new CodeMirror editor, update refs and keyboard shortcuts
9. **Clean up and test** — Remove dead code, verify all features work end-to-end

---

## Section 2: Step-by-Step Execution Plan

---

### Step 1: Add Dependencies

**Objective:** Install all npm and Cargo dependencies needed for the integration.

**Context:**
- This is the first step. No prior changes needed.
- The project uses `bun` as the package manager (see `bun.lock` and `tauri.conf.json` `beforeDevCommand`).
- The Rust backend uses Cargo with dependencies in `src-tauri/Cargo.toml`.

**Scope:**
- Files to modify: `package.json`, `src-tauri/Cargo.toml`
- No files to create or delete.

**Sub-tasks:**

1. Install CodeMirror 6 core packages via bun:
   - `codemirror` (meta-package that includes core, view, state, commands, etc.)
   - `@codemirror/lang-javascript` (we'll use this as a base for jq syntax — jq is close enough to JS for basic tokenization, or we can define a custom language later)
   - `@codemirror/autocomplete`
   - `@codemirror/lint`
   - `@codemirror/language`
   - `codemirror-languageservice` (the transport-agnostic LSP bridge)

2. Install the Tauri shell plugin frontend package:
   - `@tauri-apps/plugin-shell` (needed for sidecar permissions, though we'll primarily use Rust-side management)

3. Add `tauri-plugin-shell` to `src-tauri/Cargo.toml` dependencies:
   ```
   tauri-plugin-shell = "2"
   ```

4. Run `bun install` to update the lockfile.

**Edge Cases & Gotchas:**
- `codemirror-languageservice` requires peer dependencies on `@codemirror/autocomplete`, `@codemirror/language`, `@codemirror/lint`, `@codemirror/state`, and `@codemirror/view`. The `codemirror` meta-package should satisfy most of these, but verify after install.
- The `codemirror` meta-package re-exports from sub-packages. Imports should use the specific sub-packages (e.g., `@codemirror/view`) for tree-shaking.

**Verification:**
- `bun install` completes without errors.
- `cargo check --manifest-path src-tauri/Cargo.toml` compiles successfully.
- `import { EditorView } from '@codemirror/view'` resolves in a test file.

**Depends On:** None
**Blocks:** Steps 2, 3, 4

---

### Step 2: Build jq-lsp Sidecar Binary and Configure Tauri

**Objective:** Compile the jq-lsp Go binary and configure Tauri to bundle it as a sidecar.

**Context:**
- The jq-lsp source code is at `jq-lsp/` in the repo root. It's a standard Go module (`jq-lsp/go.mod`).
- Tauri sidecars go in `src-tauri/binaries/` and must be named with the target triple suffix.
- The `tauri.conf.json` needs an `externalBin` entry, and `capabilities/default.json` needs shell permissions.

**Scope:**
- Files to create: `src-tauri/binaries/` directory, build script (e.g., `scripts/build-sidecar.sh`)
- Files to modify: `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `package.json` (build scripts)
- The Go binary itself is not modified.

**Sub-tasks:**

1. Create the `src-tauri/binaries/` directory.

2. Create a build script at `scripts/build-sidecar.sh` that:
   - Detects the current platform's target triple (e.g., `x86_64-unknown-linux-gnu`, `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`)
   - Runs `go build -o src-tauri/binaries/jq-lsp-<target-triple>` from the `jq-lsp/` directory
   - The script should map Go's `GOOS`/`GOARCH` to Rust target triples:
     - `linux/amd64` → `x86_64-unknown-linux-gnu`
     - `darwin/arm64` → `aarch64-apple-darwin`
     - `darwin/amd64` → `x86_64-apple-darwin`
     - `windows/amd64` → `x86_64-pc-windows-msvc` (binary gets `.exe` suffix)
   - Make the script executable.

3. Add `"externalBin"` to `src-tauri/tauri.conf.json` inside the `"bundle"` section:
   ```json
   "externalBin": ["binaries/jq-lsp"]
   ```

4. Update `src-tauri/capabilities/default.json` to add shell permissions. Add these to the `"permissions"` array:
   - `"shell:allow-spawn"` — needed to spawn the sidecar
   - `"shell:allow-stdin-write"` — needed to write to the sidecar's stdin
   Note: For sidecar-specific scoping, the permissions may need to be objects with `allow` arrays specifying `{ "name": "binaries/jq-lsp", "sidecar": true }`. Check the Tauri v2 shell plugin docs for the exact format. A simpler approach that works is just adding the string permissions.

5. Add a `"build:sidecar"` script to `package.json`:
   ```json
   "build:sidecar": "bash scripts/build-sidecar.sh"
   ```

6. Update the `beforeDevCommand` and `beforeBuildCommand` in `tauri.conf.json` to run the sidecar build first. Change:
   - `"beforeDevCommand": "bun run build:sidecar && bun run dev"`
   - `"beforeBuildCommand": "bun run build:sidecar && bun run build"`

7. Add `src-tauri/binaries/` to `.gitignore` (the compiled binaries should not be committed).

**Edge Cases & Gotchas:**
- On Windows, the Go binary must have a `.exe` extension. The build script must handle this.
- The target triple detection must match exactly what Tauri expects. If it doesn't match, Tauri will fail to find the sidecar at runtime with a "sidecar not found" error.
- Go must be installed in the build environment. If it's not, the build script should fail with a clear error message.
- The `jq-lsp/` directory has its own `.git/` — it's a git submodule or a cloned repo. The build script should work from the repo root.

**Verification:**
- Running `bash scripts/build-sidecar.sh` produces a binary at `src-tauri/binaries/jq-lsp-<triple>`.
- The binary is executable: `./src-tauri/binaries/jq-lsp-<triple> --version` prints a version string.
- `cargo tauri dev` starts without sidecar-related errors.

**Depends On:** Step 1 (for tauri-plugin-shell)
**Blocks:** Step 3

---

### Step 3: Implement Rust LSP Client

**Objective:** Create a Rust module that manages the jq-lsp sidecar process, handles JSON-RPC framing over stdio, and exposes Tauri commands for hover, completion, didChange, and diagnostics.

**Context:**
- jq-lsp communicates via JSON-RPC 2.0 over stdio with `Content-Length` headers (standard LSP transport).
- The LSP protocol flow is: `initialize` → `initialized` → `textDocument/didOpen` → (hover/completion/diagnostics on demand).
- jq-lsp sends diagnostics as notifications (no request ID) via `textDocument/publishDiagnostics` in response to `didOpen`/`didChange`.
- The Rust module needs to handle both request/response pairs (hover, completion) and server-initiated notifications (diagnostics).

**Scope:**
- Files to create:
  - `src-tauri/src/lsp_client.rs` — The LSP client module
  - `src-tauri/src/commands/lsp.rs` — Tauri commands for LSP operations
- Files to modify:
  - `src-tauri/src/lib.rs` — Register the shell plugin and new commands
  - `src-tauri/src/commands/mod.rs` — Add `pub mod lsp;`
  - `src-tauri/src/state.rs` — Add LSP client state

**Sub-tasks:**

1. **Create `src-tauri/src/lsp_client.rs`** with the following structure:

   a. **`LspClient` struct** that holds:
      - A `CommandChild` (from `tauri-plugin-shell`) for the jq-lsp process — or more precisely, a handle to write to stdin
      - A `tokio::sync::Mutex<BufWriter<ChildStdin>>` for writing to the process stdin (thread-safe)
      - An `AtomicU64` for generating unique JSON-RPC request IDs
      - A `DashMap<u64, tokio::sync::oneshot::Sender<serde_json::Value>>` (or `HashMap` behind a Mutex) for pending request callbacks
      - A `tokio::sync::watch::Sender<Vec<Diagnostic>>` for broadcasting diagnostics to the frontend
      - A `bool` flag indicating whether the server has been initialized

   b. **JSON-RPC framing functions:**
      - `encode_message(value: &serde_json::Value) -> Vec<u8>` — Serializes a JSON value and prepends `Content-Length: N\r\n\r\n`
      - `read_message(reader: &mut BufReader<impl Read>) -> Result<serde_json::Value>` — Reads `Content-Length` header, then reads exactly that many bytes, then parses JSON. This runs in a background task reading from the process stdout.

   c. **`LspClient::start(app_handle: &AppHandle) -> Result<Self>`** method:
      - Spawns the jq-lsp sidecar using `app_handle.shell().sidecar("binaries/jq-lsp").spawn()`
      - Starts a background `tokio::spawn` task that reads stdout events from the `CommandEvent` receiver
      - The background task accumulates bytes into a buffer, parses JSON-RPC messages (handling Content-Length framing), and routes them:
        - If the message has an `id` field → it's a response to a pending request → resolve the corresponding oneshot sender
        - If the message has a `method` field (no `id`) → it's a notification → if `method == "textDocument/publishDiagnostics"`, broadcast via the watch channel
      - Sends the `initialize` request and waits for the response
      - Sends the `initialized` notification

   d. **`LspClient::request(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value>`** method:
      - Generates a unique ID
      - Creates a oneshot channel
      - Stores the sender in the pending map
      - Encodes and writes the JSON-RPC request to stdin
      - Awaits the oneshot receiver with a timeout (e.g., 5 seconds)

   e. **`LspClient::notify(&self, method: &str, params: serde_json::Value) -> Result<()>`** method:
      - Encodes and writes a JSON-RPC notification (no `id` field) to stdin

   f. **`LspClient::shutdown(&self) -> Result<()>`** method:
      - Sends `shutdown` request, then `exit` notification
      - Kills the child process if it doesn't exit within 2 seconds

2. **Create `src-tauri/src/commands/lsp.rs`** with these Tauri commands:

   a. **`lsp_initialize`** — Called once when the app starts. Starts the LSP client if not already running. Returns success/failure.

   b. **`lsp_did_change(uri: String, text: String)`** — Sends `textDocument/didChange` to jq-lsp with the full document text. The `uri` should be a synthetic URI like `file:///query.jq`. Returns the diagnostics that come back (or they can be emitted via a Tauri event).

   c. **`lsp_hover(uri: String, line: u32, character: u32) -> Option<HoverResult>`** — Sends `textDocument/hover` and returns the result. `HoverResult` is a struct with a `contents: String` field (markdown).

   d. **`lsp_complete(uri: String, line: u32, character: u32) -> Vec<CompletionItem>`** — Sends `textDocument/completion` and returns the items. `CompletionItem` is a struct with `label: String`, `kind: u32`, `insert_text: Option<String>`, `documentation: Option<String>`.

   e. **`lsp_shutdown`** — Shuts down the LSP client. Called when the app closes.

3. **Update `src-tauri/src/state.rs`:**
   - Add an `lsp_client: tokio::sync::Mutex<Option<LspClient>>` field to `AppState`
   - Initialize it as `None` in `Default`

4. **Update `src-tauri/src/commands/mod.rs`:**
   - Add `pub mod lsp;`

5. **Update `src-tauri/src/lib.rs`:**
   - Add `.plugin(tauri_plugin_shell::init())` to the Tauri builder
   - Add the new LSP commands to `generate_handler![]`:
     - `commands::lsp::lsp_initialize`
     - `commands::lsp::lsp_did_change`
     - `commands::lsp::lsp_hover`
     - `commands::lsp::lsp_complete`
     - `commands::lsp::lsp_shutdown`

**Edge Cases & Gotchas:**
- **JSON-RPC framing is critical.** The `Content-Length` header uses `\r\n\r\n` as the separator. The body is exactly `Content-Length` bytes of UTF-8 JSON. If the framing is off by even one byte, all subsequent messages will be corrupted.
- **jq-lsp's stdout events from `tauri-plugin-shell` come as line-based events**, not raw bytes. This is a problem because LSP messages span multiple lines and include binary-length framing. The `CommandEvent::Stdout` from the shell plugin splits on newlines. **Workaround:** We may need to use raw byte mode or accumulate line events and reconstruct the Content-Length framing. Alternatively, we can use `std::process::Command` directly instead of the shell plugin's sidecar mechanism, which gives us raw `ChildStdout` access. This is the safer approach for LSP communication.
- **IMPORTANT: Consider using `std::process::Command` instead of `tauri-plugin-shell`** for the actual process spawning. The shell plugin's event-based stdout is designed for line-oriented output, not binary-framed protocols like LSP. Using `std::process::Command::new(sidecar_path).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn()` gives direct access to the raw stdin/stdout streams, which is what we need for proper Content-Length framing. The sidecar path can be resolved using `app_handle.path().resource_dir()` or by looking up the sidecar path from the Tauri environment. Use `tauri::utils::platform::current_exe()` and resolve relative to it, or use the `TAURI_ENV` to find the binaries directory.
- **Diagnostics are asynchronous.** When we send `didChange`, jq-lsp responds with a `publishDiagnostics` notification (not a response to the request). The background reader task must detect these and make them available. The simplest approach: the `lsp_did_change` command sends the notification, then waits briefly (e.g., 100ms) for diagnostics to arrive via the watch channel, then returns whatever diagnostics are available.
- **The `initialize` request must include `capabilities` and `rootUri`.** Based on the test data, a minimal initialize params is `{}` but a proper one should include `{ "processId": null, "rootUri": "file:///", "capabilities": {} }`.
- **Thread safety:** The `LspClient` will be accessed from multiple Tauri command handlers concurrently. All mutable state must be behind appropriate synchronization primitives.

**Verification:**
- `cargo check --manifest-path src-tauri/Cargo.toml` compiles.
- Unit test: Create a test that encodes a JSON-RPC message and verifies the Content-Length header is correct.
- Integration test: Start the app, check logs for successful `initialize` handshake with jq-lsp.

**Depends On:** Step 2 (sidecar binary must exist)
**Blocks:** Steps 5, 6, 7

---

### Step 4: Create CodeMirror 6 Editor Component

**Objective:** Build a new React component that wraps CodeMirror 6, replacing the current `<textarea>` in the query editor. This step focuses on the basic editor setup without LSP features.

**Context:**
- The current `QueryEditor.tsx` uses a `<Textarea>` component with `value`/`onChange` controlled state.
- CodeMirror 6 manages its own state internally via `EditorState` and `EditorView`. It's not a controlled React component — you create it imperatively and sync state via transactions.
- The editor needs to: display jq code, support Ctrl+Enter to execute, support Escape to cancel, and sync its content back to the React state.

**Scope:**
- Files to create:
  - `src/components/query/JqEditor.tsx` — The new CodeMirror-based editor component
  - `src/components/query/jq-language.ts` — Basic jq language support (syntax highlighting)
- Files that will be modified in Step 8 (not this step): `QueryEditor.tsx`, `AppShell.tsx`

**Sub-tasks:**

1. **Create `src/components/query/jq-language.ts`:**
   - Define a basic jq language mode for CodeMirror. Options:
     - Use `@codemirror/lang-javascript` as a starting point (jq shares some syntax with JS)
     - Or define a simple `StreamLanguage` using `@codemirror/language` with a basic tokenizer that highlights: keywords (`def`, `as`, `if`, `then`, `else`, `elif`, `end`, `try`, `catch`, `reduce`, `foreach`, `import`, `include`, `label`, `break`), strings, numbers, operators (`|`, `//`, `.`, `?`), comments (`#`), variables (`$name`), format strings (`@base64`, `@html`, `@csv`, `@tsv`, `@json`, `@text`, `@sh`, `@uri`), and builtins.
   - Export a `jqLanguage()` function that returns a `LanguageSupport` instance.

2. **Create `src/components/query/JqEditor.tsx`:**
   - Props interface:
     ```
     type JqEditorProps = {
       value: string;
       onChange: (value: string) => void;
       onExecute: () => void;
       onCancel: () => void;
       disabled: boolean;
       isValid: boolean | null;
       diagnostics?: Diagnostic[];  // For Step 7
       className?: string;
     }
     ```
   - Use a `useRef<HTMLDivElement>` for the editor container.
   - Use a `useRef<EditorView>` to hold the CodeMirror view instance.
   - In a `useEffect`, create the `EditorView` with:
     - `EditorState.create()` with extensions:
       - `jqLanguage()` from the language file
       - A dark theme (use `@codemirror/theme-one-dark` or create a custom theme matching the app's dark mode)
       - `keymap.of([...defaultKeymap])` for basic editing
       - A custom keymap for Ctrl+Enter (calls `onExecute`) and Escape (calls `onCancel`)
       - `EditorView.updateListener.of(update => { if (update.docChanged) onChange(update.state.doc.toString()) })` to sync changes back to React
       - Placeholder text extension
       - `EditorView.editable.of(!disabled)` for the disabled state
     - Mount it to the container div
   - In a cleanup effect, destroy the view.
   - When `value` prop changes externally (e.g., reset), update the editor content via a transaction — but only if the new value differs from the current editor content (to avoid infinite loops).
   - Apply border styling based on `isValid` prop (green for valid, red for invalid, default otherwise) — use CodeMirror's `EditorView.theme()` or apply CSS classes to the container div.

3. **Style the editor:**
   - The CodeMirror editor should match the existing app's dark theme.
   - Set a minimum height similar to the current textarea (4 rows ≈ ~80px).
   - Use `font-mono text-xs` equivalent styling.
   - The editor should fill its container and be scrollable for long queries.

**Edge Cases & Gotchas:**
- **React strict mode** causes effects to run twice in development. The CodeMirror view creation must be idempotent — check if a view already exists before creating a new one, or clean up properly.
- **Controlled vs uncontrolled:** CodeMirror is inherently uncontrolled. The `value` prop should only be used for initial value and external resets (e.g., when closing a file). Don't try to set the editor content on every keystroke — that will cause cursor position issues.
- **The `onChange` callback** will fire on every keystroke. The parent component should debounce if needed (the existing `useQueryExecution` already debounces validation at 300ms).
- **Memory leaks:** The `EditorView` must be destroyed in the cleanup function of the effect. If the component unmounts without cleanup, it will leak DOM nodes and event listeners.

**Verification:**
- Render the `JqEditor` component in isolation (or temporarily in `QueryEditor.tsx`).
- Type jq expressions and verify syntax highlighting works.
- Verify Ctrl+Enter and Escape callbacks fire.
- Verify the `onChange` callback receives the current editor content.
- Verify the editor respects the `disabled` prop.

**Depends On:** Step 1 (CodeMirror packages must be installed)
**Blocks:** Step 8

---

### Step 5: Wire Up LSP Hover

**Objective:** Connect CodeMirror's hover tooltip system to the jq-lsp `textDocument/hover` endpoint via the Rust backend.

**Context:**
- The Rust LSP client (Step 3) exposes an `lsp_hover` Tauri command.
- `codemirror-languageservice` provides `createHoverTooltipSource()` which takes a `doHover` function.
- jq-lsp returns hover results as markdown strings (e.g., `` ```jq\ndef fromjson:\n```\nThe `tojson` and `fromjson`... ``).

**Scope:**
- Files to create:
  - `src/services/lsp-service.ts` — Frontend service that wraps Tauri LSP commands
  - `src/components/query/lsp-extensions.ts` — CodeMirror extensions for LSP features
- Files to modify:
  - `src/services/tauri-commands.ts` — Add LSP command wrappers
  - `src/components/query/JqEditor.tsx` — Add hover extension

**Sub-tasks:**

1. **Add LSP Tauri command wrappers to `src/services/tauri-commands.ts`:**
   - `lspInitialize(): Promise<void>` — Calls `invoke("lsp_initialize")`
   - `lspDidChange(uri: string, text: string): Promise<LspDiagnostic[]>` — Calls `invoke("lsp_did_change", { uri, text })`
   - `lspHover(uri: string, line: number, character: number): Promise<HoverResult | null>` — Calls `invoke("lsp_hover", { uri, line, character })`
   - `lspComplete(uri: string, line: number, character: number): Promise<CompletionItem[]>` — Calls `invoke("lsp_complete", { uri, line, character })`
   - `lspShutdown(): Promise<void>` — Calls `invoke("lsp_shutdown")`
   - Define TypeScript types for `HoverResult`, `CompletionItem`, `LspDiagnostic`.

2. **Create `src/components/query/lsp-extensions.ts`:**
   - Import `createHoverTooltipSource` from `codemirror-languageservice`.
   - Create a `jqHoverTooltip(documentUri: string)` function that returns a CodeMirror extension:
     - Uses `createHoverTooltipSource` with a `doHover` function that:
       - Receives the document and position from CodeMirror
       - Calls `tauriCommands.lspHover(documentUri, position.line, position.character)`
       - Returns the result in the format expected by `codemirror-languageservice` (an LSP `Hover` object)
     - Provides a `markdownToDom` function that converts the markdown hover content to DOM nodes. A simple approach: create a `<pre>` element for code blocks and `<p>` elements for text. Or use a lightweight markdown renderer.
   - Export the extension.

3. **Update `JqEditor.tsx`:**
   - Import the hover extension from `lsp-extensions.ts`.
   - Add it to the CodeMirror extensions array.
   - The `documentUri` should be a constant like `"file:///query.jq"` (jq-lsp needs a URI for each document).

**Edge Cases & Gotchas:**
- **Hover requests should be debounced** — CodeMirror's `hoverTooltip` already handles this (it waits for the mouse to hover for a configurable delay before triggering).
- **If jq-lsp hasn't received a `didOpen`/`didChange` for the document yet**, hover will return null. The `didChange` must be sent before hover can work. This is handled in Step 7 when we wire up diagnostics (which sends `didChange` on every edit).
- **Markdown rendering:** jq-lsp returns markdown with code blocks. At minimum, render `` ```jq `` blocks as `<pre><code>` and plain text as paragraphs. A full markdown parser is overkill — a simple regex-based converter is sufficient.
- **The `codemirror-languageservice` `doHover` function** receives a `TextDocument` (from `vscode-languageserver-textdocument` package) and a `Position`. Check if `codemirror-languageservice` requires this package as a peer dependency and install it if needed.

**Verification:**
- Type a jq expression like `fromjson` in the editor.
- Hover over `fromjson` with the mouse.
- A tooltip should appear showing the function signature and documentation.
- Hover over whitespace or unknown tokens should show nothing.

**Depends On:** Steps 3 (Rust LSP client), 4 (CodeMirror editor)
**Blocks:** Step 8

---

### Step 6: Wire Up LSP Autocomplete

**Objective:** Connect CodeMirror's autocompletion system to the jq-lsp `textDocument/completion` endpoint.

**Context:**
- jq-lsp returns completion items with `label`, `kind` (3=Function, 6=Variable), optional `insertText`, `insertTextFormat`, and `documentation` (markdown).
- `codemirror-languageservice` provides `createCompletionSource()`.

**Scope:**
- Files to modify:
  - `src/components/query/lsp-extensions.ts` — Add completion extension
  - `src/components/query/JqEditor.tsx` — Add completion extension

**Sub-tasks:**

1. **Add completion extension to `src/components/query/lsp-extensions.ts`:**
   - Create a `jqCompletionSource(documentUri: string)` function that returns a CodeMirror extension:
     - Uses `createCompletionSource` with a `doComplete` function that:
       - Calls `tauriCommands.lspComplete(documentUri, position.line, position.character)`
       - Returns the result as an LSP `CompletionList` or `CompletionItem[]`
     - Maps LSP completion item kinds to CodeMirror completion types:
       - Kind 3 (Function) → `"function"`
       - Kind 6 (Variable) → `"variable"`
     - Provides `markdownToDom` for documentation rendering in the completion detail panel.

2. **Update `JqEditor.tsx`:**
   - Import the completion extension.
   - Add `@codemirror/autocomplete`'s `autocompletion()` extension with the LSP completion source as an override.
   - Configure autocompletion to activate on typing (not just on Ctrl+Space). Set `activateOnTyping: true`.

**Edge Cases & Gotchas:**
- **Snippet support:** jq-lsp returns `insertTextFormat: 2` (Snippet) for functions with arguments, e.g., `fromstream($0)`. CodeMirror's autocomplete doesn't natively support LSP snippet syntax. For now, strip the `$0` placeholder and just insert the text. Or use a snippet extension if available.
- **Completion triggers:** jq-lsp doesn't specify trigger characters in its `completionProvider` capability (it returns `{}`). Completion is triggered by the client when the user types. CodeMirror's `activateOnTyping` will handle this.
- **Performance:** Completion requests go through Tauri IPC → Rust → jq-lsp stdio → back. This round trip should be fast (<50ms) but if it's slow, consider adding a loading indicator or increasing the debounce.
- **The completion list may be large** (all jq builtins). CodeMirror handles this well with its virtual scrolling in the completion dropdown.

**Verification:**
- Type `from` in the editor.
- An autocomplete dropdown should appear showing `from_entries`, `fromjson`, `fromdate`, `fromdateiso8601`, `fromstream(f)`, etc.
- Selecting an item should insert it into the editor.
- Type `$` after a binding (e.g., `. as $x | $`) and verify variable completions appear.

**Depends On:** Steps 3 (Rust LSP client), 4 (CodeMirror editor), 5 (lsp-extensions.ts exists)
**Blocks:** Step 8

---

### Step 7: Wire Up LSP Diagnostics (Replace jaq Validation)

**Objective:** Replace the current jaq-based `validateJqQuery` with LSP diagnostics from jq-lsp, showing inline error markers in the CodeMirror editor.

**Context:**
- Currently, `useQueryExecution.ts` calls `tauriCommands.validateJqQuery()` with a 300ms debounce. This uses jaq's parser in Rust.
- jq-lsp sends `textDocument/publishDiagnostics` notifications after `didOpen`/`didChange`, which include precise error positions and messages.
- `codemirror-languageservice` provides `createLintSource()` for diagnostics.

**Scope:**
- Files to modify:
  - `src/components/query/lsp-extensions.ts` — Add diagnostics/lint extension
  - `src/components/query/JqEditor.tsx` — Add lint extension and didChange sync
  - `src/components/query/useQueryExecution.ts` — Remove jaq validation, use LSP diagnostics for `isValid`/`validationError`

**Sub-tasks:**

1. **Add diagnostics extension to `src/components/query/lsp-extensions.ts`:**
   - Create a `jqLintSource(documentUri: string)` function that returns a CodeMirror linter extension:
     - Uses `createLintSource` from `codemirror-languageservice` with a `doDiagnostics` function that:
       - Calls `tauriCommands.lspDidChange(documentUri, document.getText())` — this sends the document to jq-lsp and returns the diagnostics
       - Returns the diagnostics array in LSP format
     - The linter should be configured with a debounce delay (e.g., 300ms to match the current behavior).

2. **Update `JqEditor.tsx`:**
   - Add the lint extension to the CodeMirror extensions.
   - Import `linter` from `@codemirror/lint`.
   - The lint extension will automatically call `doDiagnostics` when the document changes (after the debounce).

3. **Add a new prop to `JqEditor`:**
   - `onDiagnosticsChange?: (diagnostics: LspDiagnostic[]) => void` — Called when diagnostics are updated. The parent component uses this to update `isValid` and `validationError`.

4. **Update `useQueryExecution.ts`:**
   - Remove the `useEffect` that calls `tauriCommands.validateJqQuery()` (lines 98-130).
   - Remove the `validationRunId` ref.
   - Instead, expose a `setDiagnostics(diagnostics: LspDiagnostic[])` function that:
     - Sets `isValid` to `true` if diagnostics array is empty, `false` if non-empty, `null` if query is empty.
     - Sets `validationError` to the first diagnostic's message (or null if empty).
   - The `QueryEditor` component will call `setDiagnostics` when it receives diagnostics from the lint extension.

5. **The `validateJqQuery` Tauri command can remain** for now (it's used in tests and doesn't hurt), but it's no longer called from the frontend.

**Edge Cases & Gotchas:**
- **Timing:** The `lsp_did_change` command must both send the `textDocument/didChange` notification to jq-lsp AND wait for the `publishDiagnostics` notification to come back. Since diagnostics are async notifications, the Rust side needs to wait briefly after sending `didChange` for the diagnostics response. A simple approach: after sending `didChange`, poll the diagnostics watch channel for up to 200ms.
- **Empty query:** When the query is empty, don't send `didChange` to jq-lsp. Return empty diagnostics.
- **First load:** The LSP must receive `textDocument/didOpen` before `didChange`. The first call should use `didOpen`; subsequent calls use `didChange`. Alternatively, since jq-lsp uses `TextDocumentSyncFull` (sync kind 1), every `didChange` sends the full text, so we can always use `didOpen` (or track whether we've opened the document).
- **The `isValid` border styling** currently applied to the textarea needs to be applied to the CodeMirror editor container instead.

**Verification:**
- Type an invalid jq expression like `.[[`.
- Red squiggly underlines should appear at the error position.
- The validation error message should appear below the editor.
- Type a valid expression like `.name` — no errors, green border.
- Type a function that doesn't exist like `foobar` — diagnostic should say "foobar/0 not found".

**Depends On:** Steps 3, 4, 5, 6
**Blocks:** Step 8

---

### Step 8: Update QueryEditor and AppShell — Final Integration

**Objective:** Replace the textarea-based QueryEditor with the new CodeMirror-based JqEditor, update all references, and ensure the full query execution flow works end-to-end.

**Context:**
- The `QueryEditor.tsx` currently renders a `<Textarea>`, validation error text, Run/Cancel buttons, and status text.
- The `AppShell.tsx` holds a `queryEditorRef` (HTMLTextAreaElement ref) for focusing.
- The `useKeyboardShortcuts.ts` checks for `HTMLTextAreaElement` to avoid double-firing Ctrl+Enter.

**Scope:**
- Files to modify:
  - `src/components/query/QueryEditor.tsx` — Replace Textarea with JqEditor
  - `src/components/layout/AppShell.tsx` — Update ref type, initialize/shutdown LSP
  - `src/hooks/useKeyboardShortcuts.ts` — Update HTMLTextAreaElement check
  - `src/components/query/useQueryExecution.ts` — Add `setDiagnostics` (from Step 7)

**Sub-tasks:**

1. **Update `QueryEditor.tsx`:**
   - Replace the `<Textarea>` with `<JqEditor>`.
   - Pass `value={query}`, `onChange={setQuery}`, `onExecute={() => void executeQuery()}`, `onCancel={() => void cancelExecution()}`, `disabled={!hasFileLoaded}`, `isValid={isValid}`.
   - Remove the `textareaRef` prop — CodeMirror manages its own focus. Add a `editorRef` prop instead that exposes a `focus()` method (the JqEditor can expose this via `useImperativeHandle`).
   - Keep the validation error display, Run/Cancel buttons, and status text as-is.
   - Wire up the `onDiagnosticsChange` callback to update validation state.

2. **Update `AppShell.tsx`:**
   - Change `queryEditorRef` from `useRef<HTMLTextAreaElement>` to a ref type that matches the JqEditor's imperative handle (e.g., `{ focus: () => void }`).
   - Add LSP initialization: call `tauriCommands.lspInitialize()` in a `useEffect` on mount.
   - Add LSP shutdown: call `tauriCommands.lspShutdown()` in the cleanup of the same effect.

3. **Update `useKeyboardShortcuts.ts`:**
   - The check `if (target instanceof HTMLTextAreaElement)` on line 39 prevents Ctrl+Enter from double-firing when the textarea is focused. With CodeMirror, the target will be a `<div>` with `contenteditable`. Update this check to also handle CodeMirror's editor element. The simplest approach: check if the target is inside an element with the `cm-editor` class, e.g., `if (target instanceof HTMLElement && target.closest('.cm-editor'))`.

4. **Remove the old `Textarea` import** from `QueryEditor.tsx` if it's no longer used anywhere.

5. **Test the full flow:**
   - Open a JSON file.
   - Type a jq query in the CodeMirror editor.
   - Verify autocomplete appears.
   - Hover over a builtin function — verify tooltip.
   - Verify syntax errors show inline diagnostics.
   - Press Ctrl+Enter — verify query executes.
   - Press Escape during execution — verify cancellation.
   - Close the file — verify editor resets.

**Edge Cases & Gotchas:**
- **Focus management:** CodeMirror's `EditorView` has a `.focus()` method. The `JqEditor` component should expose this via `React.forwardRef` + `useImperativeHandle`.
- **The `disabled` state** in CodeMirror is handled via `EditorView.editable.of(false)`. When the file is not loaded, the editor should be non-editable and visually dimmed.
- **The existing `cn()` utility** for conditional class names works on the container div, not on CodeMirror's internal elements. Border styling for valid/invalid state should be applied to the wrapper div.

**Verification:**
- Full end-to-end test: Open file → type query → see autocomplete → hover for docs → see diagnostics → execute → see results.
- Keyboard shortcuts work: Ctrl+O (open), Ctrl+W (close), Ctrl+Enter (execute), Escape (cancel).
- The editor is disabled when no file is loaded.
- The editor resets when a file is closed.

**Depends On:** Steps 4, 5, 6, 7
**Blocks:** Step 9

---

### Step 9: Clean Up and Test

**Objective:** Remove dead code, ensure all features work, and verify the build succeeds.

**Context:**
- After all integration steps, there may be unused imports, dead validation code, or stale types.

**Scope:**
- Files to potentially modify: various (cleanup)
- Files to potentially delete: none (the old Textarea component is a shared UI component and may be used elsewhere)

**Sub-tasks:**

1. **Remove the `validateJqQuery` call from the frontend:**
   - Verify `tauriCommands.validateJqQuery` is no longer imported or called anywhere in the frontend code.
   - The Rust-side `validate_jq_query` command can remain (it's still useful for the Rust tests and could be used as a fallback).

2. **Clean up imports:**
   - Remove unused imports in modified files.
   - Run `bun run typecheck` (which runs `tsgo --noEmit`) to catch type errors.

3. **Run `cargo check`** to verify the Rust code compiles.

4. **Run `cargo test`** in `src-tauri/` to verify existing Rust tests still pass.

5. **Run `bun run build`** to verify the frontend builds.

6. **Manual testing checklist:**
   - [ ] App starts without errors
   - [ ] jq-lsp process starts (check logs)
   - [ ] Open a JSON file
   - [ ] Type `.` — autocomplete shows field names (if jq-lsp supports input-aware completion; it may not — it shows all builtins)
   - [ ] Type `from` — autocomplete shows `fromjson`, `from_entries`, etc.
   - [ ] Type `$` after a binding — autocomplete shows variables
   - [ ] Hover over `length` — tooltip shows documentation
   - [ ] Hover over `map` — tooltip shows documentation
   - [ ] Type `.[[` — inline error diagnostic appears
   - [ ] Type `foobar` — "foobar/0 not found" diagnostic appears
   - [ ] Type `.name` — no errors, valid indicator
   - [ ] Ctrl+Enter executes the query
   - [ ] Results appear in the result viewer
   - [ ] Escape cancels a running query
   - [ ] Close file — editor resets
   - [ ] Close app — no orphaned jq-lsp processes

**Edge Cases & Gotchas:**
- **Orphaned processes:** Verify that when the app closes, the jq-lsp process is also terminated. The Rust `Drop` implementation or the app close handler should kill the child process.
- **Multiple rapid edits:** Type quickly and verify the LSP doesn't get overwhelmed. The debounce in the lint extension should prevent this.

**Verification:**
- `bun run typecheck` passes.
- `cargo check --manifest-path src-tauri/Cargo.toml` passes.
- `cargo test --manifest-path src-tauri/Cargo.toml` passes.
- `bun run build` succeeds.
- All manual testing checklist items pass.

**Depends On:** Step 8
**Blocks:** None

---

## Section 3: Parallelizing with AI Agents

The 9-step plan has a dependency graph that allows several steps to be worked on concurrently. When assigning work to multiple AI agents, the key constraint is that an agent must not start a step until all steps it depends on are complete and their output is committed/available in the repo.

### 3.1 — Dependency Graph

```
Step 1 (Dependencies)
  ├── Step 2 (Sidecar Binary)
  │     └── Step 3 (Rust LSP Client)
  │           ├── Step 5 (Hover)
  │           ├── Step 6 (Autocomplete)
  │           └── Step 7 (Diagnostics)
  └── Step 4 (CodeMirror Editor)
        ├── Step 5 (Hover)
        ├── Step 6 (Autocomplete)
        └── Step 7 (Diagnostics)

Steps 5, 6, 7 → Step 8 (Final Integration)
Step 8 → Step 9 (Cleanup & Test)
```

### 3.2 — Parallel Execution Waves

**Wave 1 — Sequential prerequisite (1 agent):**
- Agent A: Step 1 (Install dependencies)

There is no parallelism here. All subsequent work depends on the packages being installed.

**Wave 2 — Parallel foundation (2 agents simultaneously):**
- Agent A: Step 2 (Build sidecar) → then immediately Step 3 (Rust LSP client)
- Agent B: Step 4 (CodeMirror editor component)

Steps 3 and 4 are fully independent of each other. Agent A works entirely in `src-tauri/`; Agent B works entirely in `src/`. They touch no shared files.

**Wave 3 — Parallel LSP feature wiring (3 agents simultaneously):**

Once Steps 3 and 4 are both complete:
- Agent A: Step 5 (Hover)
- Agent B: Step 6 (Autocomplete)
- Agent C: Step 7 (Diagnostics)

These three steps all write to `src/components/query/lsp-extensions.ts` and `src/components/query/JqEditor.tsx`. To avoid merge conflicts, scope each agent's work to named exports within those files:
- Agent A owns: `jqHoverTooltip()` export in `lsp-extensions.ts` and the hover extension addition in `JqEditor.tsx`
- Agent B owns: `jqCompletionSource()` export in `lsp-extensions.ts` and the autocomplete extension addition in `JqEditor.tsx`
- Agent C owns: `jqLintSource()` export in `lsp-extensions.ts` and the lint extension addition + `onDiagnosticsChange` prop in `JqEditor.tsx`

Each agent should add its extension to a separate named constant in `JqEditor.tsx` rather than inline into the shared extensions array. The final merge into the array can be done in Step 8.

**Wave 4 — Sequential integration (1 agent):**
- Agent A: Step 8 (Final integration — QueryEditor, AppShell, keyboard shortcuts)

This step touches the widest set of files and depends on all of Wave 3 completing correctly. It should be done by a single agent to avoid cross-cutting conflicts.

**Wave 5 — Sequential cleanup (1 agent):**
- Agent A: Step 9 (Clean up and test)

### 3.3 — Agent Handoff Protocol

Each agent should follow this protocol at the end of its step:

1. **Commit its changes** to a feature branch named `lsp/step-N` (e.g., `lsp/step-3`).
2. **Write a brief completion note** in its response summarizing:
   - What files were created/modified
   - Any deviations from the plan (and why)
   - Any open issues or gotchas discovered during implementation
   - Which verification checks passed
3. **Do not proceed** to a later step without explicit instruction — the orchestrating agent or human decides when to merge and unblock the next wave.

### 3.4 — Files Each Agent Owns (Conflict Avoidance)

| Wave | Agent | Files Owned |
|------|-------|-------------|
| 1 | A | `package.json`, `src-tauri/Cargo.toml` |
| 2A | A | `src-tauri/src/lsp_client.rs`, `src-tauri/src/commands/lsp.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/state.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`, `scripts/build-sidecar.sh` |
| 2B | B | `src/components/query/JqEditor.tsx`, `src/components/query/jq-language.ts` |
| 3A | A | `src/services/tauri-commands.ts` (hover types + invoke), `lsp-extensions.ts` (hover export only) |
| 3B | B | `src/services/lsp-service.ts` (completion types), `lsp-extensions.ts` (completion export only) |
| 3C | C | `lsp-extensions.ts` (lint export only), `src/components/query/useQueryExecution.ts` |
| 4 | A | `src/components/query/QueryEditor.tsx`, `src/components/layout/AppShell.tsx`, `src/hooks/useKeyboardShortcuts.ts` |
| 5 | A | All files (cleanup pass) |

### 3.5 — Context Each Agent Needs

When launching an agent for a specific step, provide it with:

1. The full text of this plan document (or the relevant step section).
2. The current state of any files it will modify (read them fresh from the repo, not from a prior agent's memory).
3. The **completion notes** from any agents whose steps it depends on — these document deviations from the plan that may affect the current step.
4. For Wave 3 agents: the exact function signatures and type definitions produced in Steps 3 and 4, since the LSP wiring must match the Rust command signatures precisely.

### 3.6 — Estimated Wall-Clock Time Savings

| Execution mode | Estimated time |
|----------------|---------------|
| Sequential (one agent, one step at a time) | ~4–6 hours |
| Parallel (waves as described above) | ~1.5–2.5 hours |

The biggest gains come from Wave 2 (Steps 3 and 4 running simultaneously) because Step 3 (the Rust LSP client) is the most complex and time-consuming step. Running it in parallel with the CodeMirror editor component prevents it from blocking the entire LSP wiring wave.
