# jq-desktop: Architecture & Execution Plan

---

## Section 1: High-Level Overview

### 1.1 — Goal Statement

Build **jq-desktop**, a Tauri v2 desktop application that allows users to open, browse, and query large JSON files (up to 4GB) using jq syntax. The application features a Rust backend for file loading and jq processing, and a React + shadcn/ui frontend with a virtualized tree viewer for performant navigation of massive JSON structures.

### 1.2 — Approach Summary

**Architecture:** Three-tier lazy-loading architecture where the Rust backend owns the parsed JSON data, and the React frontend requests only the visible portion on demand. This is the only viable approach for 4GB files — the full JSON cannot be sent to the webview.

**Key technical choices:**

- **jq engine:** `jaq-core` (Rust-native jq implementation). Chosen over `xq` for its superior performance (wins 23/30 benchmarks vs jq), security audit, 100% docs coverage, extensible `ValT` trait, pure-Rust compilation (no native C deps like `xq`'s oniguruma), and active maintenance (3.4k stars). The xq author themselves recommends jaq.
- **JSON tree viewer:** `react-arborist` for virtualized tree rendering. Chosen for its built-in virtualization, lazy-load-capable architecture, keyboard navigation, search integration, and shadcn/ui-compatible custom node renderers. Alternative `react-obj-view` considered but has 1.11MB bundle and is less customizable. `@microlink/react-json-view` has no virtualization.
- **IPC strategy:** Tauri v2 **Channels** for streaming file data + progress, and standard **Commands** for on-demand tree node expansion and jq query execution. Channels provide ordered, low-overhead streaming optimized for large payloads. Standard commands are used for request-response patterns (expand node, run query).
- **Backend JSON storage:** In-memory `serde_json::Value` tree held in `Mutex<AppState>` behind Tauri's managed state. Each node is addressable by a path-based ID (e.g., `"root.users[0].name"`). For files that can't fit in memory, we stream-parse and provide degraded functionality with an error/warning.
- **Frontend stack:** React 19 + Vite 7 + Tailwind CSS v4 + shadcn/ui (new-york style, already configured) + react-arborist.

**Data flow for file open:**
1. User picks file via `tauri-plugin-dialog`
2. Rust reads file, streams progress to frontend via Channel
3. Rust parses JSON into `serde_json::Value`, stores in state
4. Rust sends root-level tree metadata (keys, types, child counts) to frontend
5. Frontend renders root nodes in react-arborist
6. On expand, frontend calls `expand_node` command → Rust returns immediate children metadata
7. Only visible nodes + small overscan buffer are in the DOM at any time

**Data flow for jq query:**
1. User types jq expression in editor
2. Frontend debounces, calls `run_jq_query` command
3. Rust compiles jq via `jaq-core`, runs against in-memory Value
4. Results stream back via Channel (could be large)
5. Frontend displays results in a second tree viewer pane (or raw text for primitives)

### 1.3 — Decisions Log

- **Decision:** Use `jaq-core` over `xq` for jq processing
  - **Alternatives considered:** `xq`, shelling out to system `jq` binary
  - **Rationale:** jaq is faster (23/30 benchmarks), has a security audit, 100% doc coverage, pure Rust (no C deps), and the xq author recommends jaq. Shelling out to jq would add an external dependency and make distribution harder.

- **Decision:** Use `react-arborist` for tree visualization
  - **Alternatives considered:** `react-obj-view`, `@tanstack/react-virtual` + custom tree, `@microlink/react-json-view`
  - **Rationale:** react-arborist provides virtualization out-of-the-box, supports lazy-loaded children, has custom node renderers (for shadcn styling), and is actively maintained. @tanstack/react-virtual requires building the entire tree component from scratch. react-obj-view is purpose-built for JSON but has a larger bundle and is less customizable. @microlink/react-json-view has no virtualization.

- **Decision:** Use Tauri Channels for file loading progress + large result streaming; Commands for tree node expansion
  - **Alternatives considered:** Events (too low-throughput), custom URI scheme (more complex), Commands-only (no streaming)
  - **Rationale:** Channels are purpose-built for ordered streaming in Tauri v2. Commands are ideal for request-response patterns like node expansion. Events are explicitly documented as not suitable for high-throughput scenarios.

- **Decision:** Lazy tree loading via backend node expansion (not sending entire JSON to frontend)
  - **Alternatives considered:** Send entire JSON, let frontend handle; chunk-send entire JSON via streaming
  - **Rationale:** A 4GB JSON file cannot fit in the webview's memory. Even 1GB would cause severe slowdowns. The backend must own the data and serve slices on demand.

- **Decision:** Path-based node addressing (e.g., `$.users[0].address.city`)
  - **Alternatives considered:** Integer IDs with lookup table, content-hash-based IDs
  - **Rationale:** JSON paths are deterministic, human-readable, and don't require maintaining a separate ID mapping. They can be constructed on the fly during tree traversal.

- **Decision:** Use `Mutex<AppState>` for backend state (not `RwLock`)
  - **Alternatives considered:** `RwLock`, `DashMap`, actor model
  - **Rationale:** Tauri's state management uses `Mutex` idiomatically. Read-heavy workloads could benefit from `RwLock`, but the contention is low (single user, single file at a time). Simplicity wins. Can upgrade to `RwLock` later if profiling shows contention.

- **Decision:** Use `tauri-plugin-dialog` for file picking (not `tauri-plugin-fs`)
  - **Alternatives considered:** Custom file browser, drag-and-drop only
  - **Rationale:** Native file dialog is the standard UX for desktop apps. Drag-and-drop can be added later as a secondary input method.

### 1.4 — Assumptions & Open Questions

**Assumptions:**
- Files are valid JSON (not NDJSON/JSON Lines — though this could be added later)
- Single file open at a time (no multi-tab/multi-file initially)
- The target machines have enough RAM to hold the parsed `serde_json::Value` tree (a 4GB JSON file will use ~6-10GB RAM when parsed into Value; this is a known limitation)
- Dark mode support via shadcn's built-in CSS variables (class-based toggle)
- Desktop-only (no mobile targets)

**Open Questions (non-blocking):**
- Should jq query results replace the current tree view or show in a split pane? **Plan assumes split pane.**
- Should we support saving/exporting jq results to a file? **Not in initial scope, easy to add later.**
- Should there be a history of recent files? **Not in initial scope, easy to add later.**
- For extremely large files (>2GB parsed), should we warn the user about memory? **Plan includes a file size check with warning.**

### 1.5 — Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| 4GB JSON file exceeds available RAM when parsed into `serde_json::Value` | Medium | High | Add file size check on open. Warn user if file > 1GB. Document memory requirements. Future: investigate streaming/partial parsing. |
| `jaq-core` API changes between versions | Low | Medium | Pin exact version in Cargo.toml. The library has a stable API with 100% doc coverage. |
| react-arborist performance degrades with 100k+ visible expanded nodes | Low | Medium | Limit expand-all depth. Lazy load means only expanded paths are loaded. Typical usage won't have 100k nodes expanded simultaneously. |
| Tauri Channel serialization overhead for large jq result sets | Medium | Medium | Stream results in batches (e.g., 100 items per message). Allow cancellation of long-running queries. |
| jq query on 4GB JSON takes too long / appears hung | Medium | High | Run jq on a background thread (Tauri async commands use tokio threadpool). Send progress via Channel. Add cancel/abort mechanism. Set configurable timeout. |
| Complex jq expressions causing infinite loops or excessive memory | Low | High | jaq has no explicit recursion limits. Mitigate with a timeout on query execution. |
| Windows IPC is 40x slower than macOS for large payloads | Medium | Medium | Keep IPC payloads small (tree metadata only, not raw JSON). Batch node expansion responses. The lazy-load architecture inherently keeps payloads small. |

### 1.6 — Step Sequence Overview

```
1.  Rust backend: Project structure & dependencies — Add jaq, tokio, dialog plugin to Cargo.toml
2.  Rust backend: Application state & JSON store — Core data structures and state management
3.  Rust backend: File loading with streaming progress — Open file dialog, read, parse, report progress via Channel
4.  Rust backend: Tree node expansion API — Serve tree metadata on demand by JSON path
5.  Rust backend: jq query engine — Compile and execute jq expressions via jaq-core, stream results
6.  Rust backend: Query cancellation & error handling — Abort long queries, structured error types
7.  Frontend: Project scaffolding & layout — App shell with resizable panes (file tree + query + results)
8.  Frontend: File open flow — Integrate dialog, show loading/progress, store file metadata
9.  Frontend: JSON tree viewer component — react-arborist with lazy-loaded nodes from backend
10. Frontend: jq query editor — Input with syntax hints, debounced execution, result display
11. Frontend: Result viewer — Display jq output in tree or raw text depending on type
12. Integration: Wire everything together — End-to-end flow, capabilities/permissions, polish
13. Quality: Error states, edge cases, and UX polish — Empty states, error boundaries, keyboard shortcuts
```

---

## Section 2: Step-by-Step Execution Plan

### Step 1: Rust Backend — Project Structure & Dependencies

**Objective:** Set up the Rust project with all required dependencies and modular file structure.

**Context:**
- The project already has a scaffolded Tauri v2 + React app with a working `greet` command.
- `src-tauri/Cargo.toml` has `tauri`, `serde`, `serde_json`, and `tauri-plugin-opener`.
- We need to add `jaq-core`, `jaq-std`, `jaq-json`, `tokio`, and `tauri-plugin-dialog`.

**Scope:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/commands/mod.rs` (module for all Tauri commands)
- Create: `src-tauri/src/state.rs` (application state definitions)
- Create: `src-tauri/src/json_store.rs` (JSON data management)
- Create: `src-tauri/src/jq_engine.rs` (jaq integration)
- Create: `src-tauri/src/error.rs` (shared error types)
- Modify: `src-tauri/src/lib.rs` (module declarations, updated builder)

**Sub-tasks:**

1. Add the following dependencies to `src-tauri/Cargo.toml`:
   - `jaq-core = "2"` — Core jq filter engine
   - `jaq-std = "2"` — Standard library functions (length, keys, map, etc.)
   - `jaq-json = "2"` — JSON-specific value type and functions
   - `tokio = { version = "1", features = ["full"] }` — Async runtime for file I/O
   - `tauri-plugin-dialog = "2"` — Native file open/save dialogs
   - Keep existing: `tauri`, `serde`, `serde_json`, `tauri-plugin-opener`

2. Create `src-tauri/src/error.rs` with a shared error enum:
   - Variants: `FileNotFound`, `ParseError(String)`, `JqCompileError(String)`, `JqRuntimeError(String)`, `Cancelled`, `FileTooLarge(u64)`, `NoFileLoaded`
   - Implement `Serialize` for IPC transport
   - Implement `Display` and `std::error::Error`
   - Implement `From<std::io::Error>`, `From<serde_json::Error>`

3. Create empty module files: `src-tauri/src/commands/mod.rs`, `src-tauri/src/state.rs`, `src-tauri/src/json_store.rs`, `src-tauri/src/jq_engine.rs` — each with a comment describing its purpose.

4. Update `src-tauri/src/lib.rs`:
   - Add `mod commands; mod state; mod json_store; mod jq_engine; mod error;`
   - Remove the `greet` command
   - Keep the builder with `tauri_plugin_opener::init()` and add `tauri_plugin_dialog::init()`
   - The `invoke_handler` will be empty for now (commands added in later steps)

5. Run `bun tauri add dialog` from the project root to install the npm-side plugin package (`@tauri-apps/plugin-dialog`) and auto-configure capabilities. If this doesn't auto-update capabilities, manually add `"dialog:default"` to `src-tauri/capabilities/default.json`.

**Edge Cases & Gotchas:**
- `jaq-core`, `jaq-std`, and `jaq-json` versions must be compatible with each other. Use version `2` for all three (they're maintained in the same repo).
- The `tokio` feature `"full"` includes `fs`, `io`, `sync`, `time` — all needed. Don't use `"rt-multi-thread"` alone as we need `tokio::fs`.
- After adding `tauri-plugin-dialog`, the capabilities file must include dialog permissions or the dialog will silently fail.

**Verification:**
- `cargo check` in `src-tauri/` should compile without errors.
- `cargo build` should succeed (will take a few minutes first time due to jaq compilation).
- The module files should be recognized by the compiler (no "unresolved module" errors).

**Depends On:** None
**Blocks:** Steps 2, 3, 4, 5, 6

---

### Step 2: Rust Backend — Application State & JSON Store

**Objective:** Define the core data structures for holding parsed JSON and serving tree metadata to the frontend.

**Context:**
- Step 1 created empty module files. Now we fill in the state and json_store modules.
- The key insight: the frontend never receives raw JSON. It receives *tree node metadata* — type, key name, child count, preview text — and requests children on demand.

**Scope:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/json_store.rs`
- Modify: `src-tauri/src/lib.rs` (register managed state)

**Sub-tasks:**

1. Define `TreeNodeInfo` in `json_store.rs` — this is the serializable struct sent to the frontend:
   - `id: String` — JSON path (e.g., `"$"`, `"$.users"`, `"$.users[0].name"`)
   - `key: String` — The key name or array index (e.g., `"users"`, `"0"`, `"name"`)
   - `value_type: String` — One of: `"object"`, `"array"`, `"string"`, `"number"`, `"boolean"`, `"null"`
   - `preview: String` — Short preview of value: for objects `"{3 keys}"`, for arrays `"[5 items]"`, for primitives the actual value (truncated to ~100 chars)
   - `child_count: Option<usize>` — Number of children (for objects: key count, for arrays: length, for primitives: None)
   - `has_children: bool` — Whether this node can be expanded
   - Derive `Serialize`, `Clone`, `Debug`

2. Define `JsonStore` struct in `json_store.rs`:
   - Field: `data: Option<serde_json::Value>` — The loaded JSON
   - Field: `file_path: Option<String>` — Path of the currently loaded file
   - Field: `file_size: Option<u64>` — Size of the file in bytes
   - Method: `get_root_nodes(&self) -> Result<Vec<TreeNodeInfo>, AppError>` — Returns metadata for the top-level value. If root is an object, return one `TreeNodeInfo` per key. If root is an array, return one per element (up to first 1000). If root is a primitive, return a single node.
   - Method: `get_children(&self, path: &str, offset: usize, limit: usize) -> Result<(Vec<TreeNodeInfo>, usize), AppError>` — Given a JSON path string, navigate the tree and return `TreeNodeInfo` for each immediate child. Returns (children, total_count).
   - Method: `get_value_at_path(&self, path: &str) -> Result<&serde_json::Value, AppError>` — Internal helper to navigate to a specific node by path.
   - Method: `clear(&mut self)` — Clears loaded data.

3. Implement a path navigation helper (`get_value_at_path`):
   - Parse path string: `$` is root, `.key` descends into object key, `[N]` descends into array index.
   - Example: `"$.users[0].address"` → root → `"users"` key → index 0 → `"address"` key.
   - Return error if path segment doesn't exist or type is wrong.

4. Implement a `value_to_node_info` helper function:
   - Takes a `(&str, &str, &serde_json::Value)` — (parent_path, key, value)
   - Constructs the `TreeNodeInfo` with correct `id`, `value_type`, `preview`, `child_count`, and `has_children`
   - Preview generation: objects → `"{N keys}"`, arrays → `"[N items]"`, strings → first 100 chars in quotes, numbers/bools/null → their string representation

5. Define `AppState` in `state.rs`:
   - `json_store: std::sync::Mutex<JsonStore>`
   - Implement `Default` for `AppState` (JsonStore with all `None` fields)

6. Update `lib.rs` to register `AppState` as managed state:
   - Use `.manage(AppState::default())` on the builder.

**Edge Cases & Gotchas:**
- Path parsing must handle keys that contain dots or brackets. For simplicity, v1 can assume keys don't contain these characters. Document this limitation.
- Array children can be very large (millions of elements). `get_children` for an array path should support pagination via `offset` and `limit`.
- The `preview` field for strings should be truncated and escaped to avoid sending huge string values across IPC.
- `serde_json::Value` uses `Map<String, Value>` which preserves insertion order — important for UX (users expect keys in original order).

**Verification:**
- Write a unit test in `json_store.rs`: parse a small JSON string, call `get_root_nodes()`, verify the returned `TreeNodeInfo` items match expected types and counts.
- Write a test for `get_children("$.key")` on a nested structure.
- Write a test for `get_value_at_path` with various paths including arrays.
- `cargo test` should pass.

**Depends On:** Step 1
**Blocks:** Steps 3, 4

---

### Step 3: Rust Backend — File Loading with Streaming Progress

**Objective:** Implement the file open command that reads the file asynchronously, parses JSON, and reports progress to the frontend via a Tauri Channel.

**Context:**
- Step 2 defined `JsonStore` and `AppState`. Now we create the Tauri command that drives file loading.
- We use `tauri-plugin-dialog` on the frontend to pick a file, then pass the path to a Rust command.
- The Rust command reads the file with progress reporting via Channel, then parses it.

**Scope:**
- Create: `src-tauri/src/commands/file.rs` — File-related commands
- Modify: `src-tauri/src/commands/mod.rs` — Export file commands
- Modify: `src-tauri/src/lib.rs` — Register commands in `invoke_handler`

**Sub-tasks:**

1. Define a `LoadProgress` enum for Channel messages in `commands/file.rs`:
   - Use `#[serde(tag = "type")]` for tagged enum serialization
   - Variants:
     - `Reading { bytes_read: u64, total_bytes: u64 }` — File read progress
     - `Parsing` — Switched from reading to parsing phase
     - `Complete { root_nodes: Vec<TreeNodeInfo>, file_name: String, file_size: u64 }` — Done, here are root nodes
     - `Error { message: String }` — Something went wrong

2. Implement `load_file` Tauri command:
   - Signature: `async fn load_file(path: String, on_progress: Channel<LoadProgress>, state: tauri::State<'_, AppState>) -> Result<(), String>`
   - Steps:
     a. Get file metadata (size). If > 4GB (configurable const), return `FileTooLarge` error.
     b. Read file in chunks (e.g., 64KB) using `tokio::fs::File` + `AsyncReadExt`, accumulating into a `Vec<u8>`. Send `Reading` progress every ~1MB or on each chunk.
     c. Send `Parsing` message.
     d. Parse the `Vec<u8>` into `serde_json::Value` using `serde_json::from_slice`.
     e. Lock the `json_store` mutex, set `data`, `file_path`, `file_size`.
     f. Generate root nodes via `json_store.get_root_nodes()`.
     g. Send `Complete` with root nodes, file name (extracted from path), and file size.
     h. On any error, send `Error` message and return `Err`.

3. Implement `close_file` Tauri command:
   - Clears the `JsonStore` state via `json_store.clear()`.
   - Returns `Ok(())`.

4. Implement `get_file_info` Tauri command:
   - Returns current file name, size, and whether a file is loaded.
   - Useful for UI state restoration.

5. Register all three commands in `lib.rs`'s `invoke_handler`.

6. Update `src-tauri/capabilities/default.json` to include `"dialog:default"` permission (if not already done by `tauri add dialog`).

**Edge Cases & Gotchas:**
- File read must be async to not block the main thread. Use `tokio::fs`, not `std::fs`.
- Progress channel sends should use `.ok()` or log errors — don't let a channel send failure crash the command.
- `serde_json::from_slice` is faster than `from_str` (avoids a UTF-8 validation pass in some cases). Use `from_slice(&bytes)`.
- Extremely large files (3-4GB) may take 30-60 seconds to parse. The `Parsing` state should be communicated so the UI can show an appropriate "parsing..." indicator with indeterminate progress.
- If the user opens a new file while one is loading, the mutex on the store effectively serializes access. The UX should disable the "open" button during load.

**Verification:**
- Integration test: Create a temp JSON file, invoke `load_file`, verify `Complete` message contains correct root nodes.
- Test with empty JSON (`{}`), array root (`[1,2,3]`), primitive root (`"hello"`), and nested object.
- Test file-not-found error path.
- `cargo test` should pass.

**Depends On:** Step 2
**Blocks:** Step 8

---

### Step 4: Rust Backend — Tree Node Expansion API

**Objective:** Implement the command that returns child node metadata for a given JSON path, enabling lazy tree expansion in the frontend.

**Context:**
- Step 2 defined `JsonStore.get_children()`. Now we wrap it in a Tauri command.
- This is the most frequently called command — every time the user expands a node in the tree.

**Scope:**
- Create: `src-tauri/src/commands/tree.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` — Register command

**Sub-tasks:**

1. Define `ExpandResult` struct in `commands/tree.rs`:
   - `children: Vec<TreeNodeInfo>` — The child nodes
   - `total_children: usize` — Total number of children (for pagination info)
   - `offset: usize` — The offset used
   - `has_more: bool` — Whether there are more children beyond this batch
   - Derive `Serialize`

2. Implement `expand_node` Tauri command:
   - Signature: `fn expand_node(path: String, offset: Option<usize>, limit: Option<usize>, state: tauri::State<'_, AppState>) -> Result<ExpandResult, String>`
   - Defaults: `offset = 0`, `limit = 500`
   - Lock the state, call `json_store.get_children(path, offset, limit)`, construct `ExpandResult`, return.

3. Implement `get_node_value` Tauri command:
   - Signature: `fn get_node_value(path: String, state: tauri::State<'_, AppState>) -> Result<String, String>`
   - Returns the raw JSON string for a specific node (useful for copy-to-clipboard, showing raw value).
   - Use `serde_json::to_string_pretty` on the value at the path.
   - For very large values (>1MB serialized), truncate and add a `"... (truncated)"` suffix.

4. Register commands in `lib.rs`.

**Edge Cases & Gotchas:**
- `offset` + `limit` out of bounds should be handled gracefully (return fewer items, not an error).
- Path `"$"` refers to the root — `expand_node("$")` should be equivalent to `get_root_nodes()`.
- Deeply nested paths must be traversed efficiently. `serde_json::Value` access is O(n) for object key lookup and O(1) for array index. This is acceptable for interactive use.
- If the file is not loaded, return a clear error: `"No file loaded"`.

**Verification:**
- Unit test: Load a JSON with nested objects and arrays. Verify `expand_node("$.key")` returns correct children with correct types and previews.
- Test pagination: Array with 2000 elements, request offset=500 limit=100, verify 100 items returned starting from index 500.
- Test `get_node_value` returns pretty-printed JSON.
- `cargo test` should pass.

**Depends On:** Step 2
**Blocks:** Step 9

---

### Step 5: Rust Backend — jq Query Engine

**Objective:** Integrate `jaq-core` to compile and execute jq expressions against the loaded JSON data, streaming results to the frontend.

**Context:**
- `jaq-core`, `jaq-std`, and `jaq-json` are added as dependencies in Step 1.
- The jaq API requires: parse query → load modules → compile filter → run against input value → iterate results.

**Scope:**
- Modify: `src-tauri/src/jq_engine.rs` — Full jaq integration
- Create: `src-tauri/src/commands/query.rs` — Query-related commands
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Sub-tasks:**

1. Implement `JqEngine` in `jq_engine.rs`:
   - The core function should take a query string and a `&serde_json::Value`, and return an iterator of results.
   - Steps:
     a. Create `jaq_core::load::File { code: query, path: () }`
     b. Create loader: `jaq_core::load::Loader::new(jaq_std::defs().chain(jaq_json::defs()))`
     c. Create arena: `jaq_core::load::Arena::default()`
     d. Load modules: `loader.load(&arena, program)` — map errors to `JqCompileError`
     e. Compile: `jaq_core::Compiler::default().with_funs(jaq_std::funs().chain(jaq_json::funs())).compile(modules)` — map errors
     f. Convert `serde_json::Value` to `jaq_json::Val`
     g. Create `RcIter` for inputs (empty for single-input mode)
     h. Run filter: `filter.run((Ctx::new([], &inputs), val))` → returns iterator of `Result<Val, Error>`
     i. Collect/iterate results, converting each `Val` back to `serde_json::Value` or `String`
   - Note: Carefully manage lifetimes. The `arena`, `loader`, and `inputs` must outlive the filter execution. The function may need to own all these in a struct or collect results eagerly.

2. Define `QueryResult` enum for Channel messages in `commands/query.rs`:
   - `#[serde(tag = "type")]` tagged enum
   - Variants:
     - `Compiling` — Query is being compiled
     - `Running` — Execution started
     - `Result { index: usize, value: String, value_type: String }` — One output value (as JSON string)
     - `Complete { total_results: usize, elapsed_ms: u64 }` — Done
     - `Error { message: String }` — Compile or runtime error

3. Implement `run_jq_query` Tauri command:
   - Signature: `async fn run_jq_query(query: String, on_result: Channel<QueryResult>, state: tauri::State<'_, AppState>) -> Result<(), String>`
   - Steps:
     a. Send `Compiling`.
     b. Lock state, clone the loaded JSON value (or get a reference if lifetime allows). If no file loaded, send `Error`.
     c. Compile the query via `JqEngine`. On error, send `Error` and return.
     d. Send `Running`.
     e. Start timer. Execute filter. Iterate over results.
     f. For each result: serialize to JSON string, determine value_type, send `Result` message.
     g. Impose max result count (10,000) and max elapsed time (60 seconds). If exceeded, send a truncation warning.
     h. Send `Complete` with total count and elapsed time.

4. Implement `validate_jq_query` Tauri command:
   - Signature: `fn validate_jq_query(query: String) -> Result<bool, String>`
   - Attempts to compile the query (no execution). Returns `Ok(true)` on success, or `Err` with the compile error message.
   - Useful for real-time syntax validation in the editor.

5. Register commands in `lib.rs`.

**Edge Cases & Gotchas:**
- **Lifetime management is the hardest part of this step.** The `jaq_core::load::Arena` uses a typed arena allocator. It must live long enough for the filter to compile AND execute. The arena, loader, and filter may all need to exist in the same scope. If borrow checker issues arise, collect all results into a Vec eagerly rather than streaming lazily.
- `jaq_json::Val` to `serde_json::Value` conversion: Check the jaq-json docs for the exact conversion method. It may implement `From<Val> for serde_json::Value` or require `val.to_string()`.
- For queries that produce a single large result (e.g., `.` on a 4GB file), avoid serializing the entire thing to a string. Check the serialized size and truncate large results, indicating truncation.
- `jaq-core` differences from `jq`: null indexing yields error instead of null, array out-of-bounds yields error instead of null-fill. These may surprise users — consider documenting in the UI or catching specific errors.
- Cloning the entire `serde_json::Value` for query execution is expensive for large files. Alternative: Hold the mutex lock during query execution (blocks other operations but avoids the clone). For v1, this is acceptable. For v2, consider `Arc<Value>` or `RwLock`.

**Verification:**
- Unit test: Compile and execute `.` against `{"a":1}`, verify result is `{"a":1}`.
- Test: `.keys` on an object, verify array of keys returned.
- Test: `.[] | select(.age > 30)` on an array of objects.
- Test: Invalid query `".[[[` returns compile error.
- Test: `validate_jq_query(".name")` returns `true`.
- `cargo test` should pass.

**Depends On:** Steps 1, 2
**Blocks:** Step 10

---

### Step 6: Rust Backend — Query Cancellation & Error Handling

**Objective:** Add the ability to cancel long-running jq queries and ensure all error paths are handled gracefully.

**Context:**
- Step 5 implements basic query execution. This step adds robustness for production use.
- A query on a 4GB JSON could take 30+ seconds. Users need to cancel.

**Scope:**
- Modify: `src-tauri/src/state.rs` — Add cancellation token
- Modify: `src-tauri/src/commands/query.rs` — Check cancellation during execution
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Sub-tasks:**

1. Add a cancellation mechanism to `AppState`:
   - Add field: `query_cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>` — Shared flag checked during iteration
   - Method or helper: `cancel_query(&self)` — sets the flag to `true`
   - Method or helper: `reset_cancellation(&self)` — sets the flag to `false` (called at start of each query)

2. Update `run_jq_query` to check cancellation:
   - Before processing each result in the iterator, check `query_cancelled.load(Ordering::Relaxed)`.
   - If cancelled, send a `QueryResult::Error { message: "Query cancelled" }` via Channel and stop iteration.
   - Reset cancellation flag at the start of each query.

3. Implement `cancel_query` Tauri command:
   - Sets the cancellation flag to `true`.
   - Returns immediately (doesn't wait for the query to actually stop).

4. Add a timeout mechanism to query execution:
   - Track elapsed time during the result iteration loop.
   - Default timeout: 60 seconds (configurable constant).
   - On timeout, send `Error { message: "Query timed out after 60 seconds" }` and stop.

5. Ensure all error types in `error.rs` produce user-friendly messages:
   - `FileNotFound` → `"File not found: {path}"`
   - `ParseError` → `"Invalid JSON: {details}"`
   - `JqCompileError` → `"jq syntax error: {details}"`
   - `JqRuntimeError` → `"jq runtime error: {details}"`
   - `Cancelled` → `"Query cancelled"`
   - `FileTooLarge` → `"File is too large ({size} bytes). Maximum supported size is 4 GB."`
   - `NoFileLoaded` → `"No file loaded. Open a JSON file first."`

6. Register `cancel_query` command in `lib.rs`.

**Edge Cases & Gotchas:**
- `AtomicBool` is lock-free and safe to check in a tight loop without performance impact.
- The jaq result iterator may block on individual items (e.g., a single `reduce` over millions of elements). Cancellation can only happen between result items, not during computation of a single item. Document this limitation.
- If two queries are somehow started simultaneously (shouldn't happen with the design, but defensively), the cancellation flag affects both. For v1, this is acceptable since we only support one query at a time.

**Verification:**
- Test: Start a query that produces many results (e.g., `.[]` on a 10,000 element array). Call `cancel_query` mid-execution. Verify iteration stops and cancelled message is sent.
- Test: Verify timeout triggers with a long-running operation.
- All existing tests from Step 5 should still pass.

**Depends On:** Step 5
**Blocks:** Step 10

---

### Step 7: Frontend — Project Scaffolding & Layout

**Objective:** Replace the default Tauri template UI with the jq-desktop application shell using shadcn/ui components and a resizable split-pane layout.

**Context:**
- The project already has React 19, Vite 7, Tailwind v4, and shadcn/ui configured.
- `components.json` is set up with new-york style, `~` alias, and lucide icons.
- Only `button.tsx` exists as a UI component. We need more shadcn components.
- The app layout has three main areas: (1) toolbar/header, (2) JSON tree viewer (left pane), (3) jq query editor + results (right pane).

**Scope:**
- Install shadcn components: `resizable`, `input`, `scroll-area`, `separator`, `badge`, `tooltip`, `textarea`, `sonner` (toast)
- Create: `src/components/layout/AppShell.tsx` — Main layout wrapper
- Create: `src/components/layout/Toolbar.tsx` — Top toolbar with file actions
- Create: `src/components/layout/StatusBar.tsx` — Bottom status bar
- Modify: `src/App.tsx` — Replace template content with AppShell
- Modify: `index.html` — Update title to "jq-desktop"
- Create: `src/types/index.ts` — Shared TypeScript types
- Create: `src/hooks/useFileState.ts` — State management for loaded file

**Sub-tasks:**

1. Install required shadcn/ui components using the shadcn CLI:
   - `bunx shadcn@latest add resizable input scroll-area separator badge tooltip textarea sonner`
   - These will be added to `src/components/ui/`

2. Create shared TypeScript types in `src/types/index.ts`:
   - `TreeNodeInfo` — mirrors the Rust struct: `{ id: string; key: string; valueType: string; preview: string; childCount: number | null; hasChildren: boolean }`
   - `LoadProgress` — discriminated union matching Rust's `LoadProgress` enum (discriminant field: `type`)
   - `QueryResult` — discriminated union matching Rust's `QueryResult` enum
   - `ExpandResult` — `{ children: TreeNodeInfo[]; totalChildren: number; offset: number; hasMore: boolean }`
   - `FileInfo` — `{ fileName: string; filePath: string; fileSize: number; loaded: boolean }`

3. Create `src/hooks/useFileState.ts`:
   - Use React `useState` + `useCallback` to manage: `fileInfo: FileInfo | null`, `rootNodes: TreeNodeInfo[]`, `isLoading: boolean`, `loadProgress: number` (0-100), `loadStatus: string`, `error: string | null`
   - Export functions: `openFile()`, `closeFile()`, `setProgress()`, `setError()`, `clearError()`
   - `openFile` and `closeFile` will be wired to Tauri commands in Step 8 — for now, stub them.

4. Create `src/components/layout/AppShell.tsx`:
   - Uses shadcn's `ResizablePanelGroup` with `ResizablePanel` and `ResizableHandle`
   - Layout: Vertical stack of [Toolbar, Main Content, StatusBar]
   - Main Content: Horizontal resizable split — left panel (JSON tree, default 50%) and right panel (query + results, default 50%)
   - Right panel: Vertical split — top (query editor, ~20%) and bottom (results, ~80%)
   - Apply full height: `h-screen flex flex-col`
   - Each panel should have placeholder content for now (e.g., "JSON Tree", "Query Editor", "Results")

5. Create `src/components/layout/Toolbar.tsx`:
   - "Open File" button (with `FileJson` icon from lucide-react)
   - File name display (when loaded) — show "No file loaded" when empty
   - File size badge (when loaded)
   - "Close" button (when file loaded, with `X` icon)
   - Style with `flex items-center gap-2 px-4 py-2 border-b`

6. Create `src/components/layout/StatusBar.tsx`:
   - Shows: file path (or "Ready"), loading status
   - Fixed at bottom: `flex items-center gap-4 px-4 py-1 border-t text-xs text-muted-foreground`

7. Update `src/App.tsx`:
   - Remove all template content (logos, greet form, imports)
   - Render `<AppShell />`
   - Add `<Toaster />` from sonner
   - Apply dark mode: Add `useEffect` that sets `document.documentElement.classList.add('dark')` on mount

8. Update `index.html`:
   - Change `<title>` to `"jq-desktop"`

9. Clean up unused assets:
   - Delete `src/assets/react.svg` (template artifact)
   - Keep `public/tauri.svg` (app icon)

**Edge Cases & Gotchas:**
- shadcn/ui `resizable` component uses `react-resizable-panels` under the hood. Ensure it's installed as a dependency automatically by the shadcn CLI.
- The `~` path alias is configured in both `tsconfig.json` and `vite.config.ts` — all imports should use `~/` prefix, matching the `components.json` configuration.
- Dark mode: The CSS variables in `index.css` already support `.dark` class. Set dark as default for a developer tool aesthetic.
- The `sonner` toast component needs a `<Toaster />` component rendered at the app root level — add it in `App.tsx`.

**Verification:**
- `bun run dev` should compile without errors.
- The app should show a split-pane layout with a toolbar at top and status bar at bottom.
- Panels should be resizable by dragging the handle.
- All shadcn components should render with correct dark-mode styling.
- `bun tauri dev` should open the app in a native window with the new layout.

**Depends On:** None (frontend-only, can be done in parallel with Steps 2-6)
**Blocks:** Steps 8, 9, 10

---

### Step 8: Frontend — File Open Flow

**Objective:** Wire up the "Open File" button to the native dialog and the Rust backend, showing loading progress and handling errors.

**Context:**
- Step 7 created the layout with an "Open File" button and progress state.
- Step 3 implemented the Rust `load_file` command with Channel-based progress.
- Now we connect them.

**Scope:**
- Install npm package: `@tauri-apps/plugin-dialog` (if not already installed)
- Create: `src/services/tauri-commands.ts` — Typed wrappers for all Tauri invoke calls
- Modify: `src/hooks/useFileState.ts` — Wire to Tauri commands
- Modify: `src/components/layout/Toolbar.tsx` — Wire open button to dialog + backend
- Create: `src/components/LoadingOverlay.tsx` — Full-screen loading indicator with progress

**Sub-tasks:**

1. Install `@tauri-apps/plugin-dialog` if not already present:
   - `bun add @tauri-apps/plugin-dialog`

2. Create `src/services/tauri-commands.ts`:
   - Import `{ invoke, Channel }` from `@tauri-apps/api/core`
   - Import types from `~/types`
   - Function `loadFile(path: string, onProgress: (progress: LoadProgress) => void): Promise<void>`:
     a. Create a `Channel<LoadProgress>` instance
     b. Set `channel.onmessage = onProgress`
     c. Call `await invoke('load_file', { path, onProgress: channel })`
   - Function `expandNode(path: string, offset?: number, limit?: number): Promise<ExpandResult>`:
     a. Call `await invoke('expand_node', { path, offset, limit })`
   - Function `getNodeValue(path: string): Promise<string>`:
     a. Call `await invoke('get_node_value', { path })`
   - Function `runJqQuery(query: string, onResult: (result: QueryResult) => void): Promise<void>`:
     a. Create Channel, set onmessage, invoke
   - Function `validateJqQuery(query: string): Promise<boolean>`:
     a. Call `await invoke('validate_jq_query', { query })`
   - Function `cancelQuery(): Promise<void>`:
     a. Call `await invoke('cancel_query')`
   - Function `closeFile(): Promise<void>`:
     a. Call `await invoke('close_file')`

3. Update `src/hooks/useFileState.ts` with real implementations:
   - `openFile()` function:
     a. Call `open()` from `@tauri-apps/plugin-dialog` with filter `{ name: 'JSON Files', extensions: ['json'] }`
     b. If user cancelled (result is null), return early
     c. Set `isLoading = true`, `loadProgress = 0`
     d. Call `tauriCommands.loadFile(path, onProgress)`
     e. `onProgress` callback: switch on `type`:
       - `"Reading"`: calculate percentage, update `loadProgress` and `loadStatus`
       - `"Parsing"`: set `loadStatus = "Parsing JSON..."`, set progress to indeterminate (e.g., -1 or keep at 100%)
       - `"Complete"`: set `rootNodes`, `fileInfo`, `isLoading = false`
       - `"Error"`: set `error`, `isLoading = false`, show toast
     f. Wrap in try/catch, handle invoke errors

4. Create `src/components/LoadingOverlay.tsx`:
   - Renders when `isLoading` is true
   - Absolutely positioned overlay on the main content area
   - Shows progress bar (shadcn doesn't have a progress component by default — use a simple div with Tailwind `bg-primary h-1` and dynamic width, or install the shadcn `progress` component)
   - Status text below the progress bar
   - Semi-transparent dark background

5. Wire Toolbar "Open File" button to `useFileState().openFile()`.
6. Wire Toolbar "Close" button to `useFileState().closeFile()`.
7. Show file name and size in Toolbar when loaded.
8. Integrate `LoadingOverlay` into `AppShell`.

**Edge Cases & Gotchas:**
- The dialog `open()` function returns `null` if user cancels — handle this gracefully (just return).
- Tauri Channel parameter naming: the Rust command parameter is `on_progress: Channel<LoadProgress>`, so the invoke parameter key must be `onProgress` (camelCase, as Tauri auto-converts snake_case to camelCase).
- Progress percentage calculation: `(bytes_read / total_bytes) * 100`. Handle division by zero if file is empty.
- If file open fails (e.g., permission denied), the error should be shown as a toast, not an uncaught promise rejection.

**Verification:**
- Click "Open File" → native dialog opens → select a JSON file → progress bar shows → tree root nodes appear in state.
- Click "Open File" → cancel dialog → nothing happens (no error).
- Open a non-JSON file → parse error shown as toast.
- "Close" button clears the file state.

**Depends On:** Steps 3, 7
**Blocks:** Step 9

---

### Step 9: Frontend — JSON Tree Viewer Component

**Objective:** Build the virtualized JSON tree viewer using react-arborist, with lazy-loaded children fetched from the Rust backend on node expansion.

**Context:**
- Step 8 provides root nodes in state after file load.
- Step 4 provides the `expand_node` backend command.
- react-arborist handles virtualization; we provide a custom node renderer styled with shadcn/ui and Tailwind.

**Scope:**
- Install: `react-arborist` npm package
- Create: `src/components/json-tree/JsonTreeViewer.tsx` — Main tree component
- Create: `src/components/json-tree/JsonTreeNode.tsx` — Custom node renderer
- Create: `src/components/json-tree/useTreeData.ts` — Hook managing tree data with lazy loading
- Create: `src/components/json-tree/tree-utils.ts` — Utility functions for tree data conversion
- Modify: `src/components/layout/AppShell.tsx` — Integrate tree viewer

**Sub-tasks:**

1. Install react-arborist:
   - `bun add react-arborist`
   - If peer dependency issues with React 19, try `bun add react-arborist --force` or check for a compatible version.

2. Create `src/components/json-tree/tree-utils.ts`:
   - Define `TreeNode` type matching react-arborist's expected data shape:
     ```
     type TreeNode = {
       id: string;
       name: string;
       children?: TreeNode[] | null;
       data: TreeNodeInfo;
     }
     ```
   - `null` children = not yet loaded (lazy), `undefined` or absent = leaf, `[...]` = loaded
   - Function `treeNodeInfoToTreeNode(info: TreeNodeInfo): TreeNode` — Converts backend format. Sets `children = null` if `hasChildren` is true (triggers lazy load), `children = undefined` if leaf.
   - Function `batchConvert(infos: TreeNodeInfo[]): TreeNode[]` — Batch conversion.

3. Create `src/components/json-tree/useTreeData.ts`:
   - Takes `rootNodes: TreeNodeInfo[]` as input
   - Maintains `treeData: TreeNode[]` as React state
   - When `rootNodes` changes: reset `treeData` to converted root nodes
   - Function `loadChildren(nodeId: string)`:
     a. Call `tauriCommands.expandNode(nodeId)`
     b. Convert returned children to `TreeNode[]`
     c. Update `treeData` immutably — find the node by ID and set its `.children`
     d. Use a recursive immutable update helper that clones only the path to the modified node
   - Track loading state per node: `loadingNodes: Set<string>` to show spinner while children load
   - Handle pagination: If `ExpandResult.hasMore` is true, append a synthetic "Load more..." node

4. Create `src/components/json-tree/JsonTreeNode.tsx`:
   - Custom renderer for react-arborist's Node component
   - Layout per node row (horizontal flex, monospace font):
     - Indentation (handled by react-arborist's `style.paddingLeft` or similar)
     - Expand/collapse chevron icon (`ChevronRight` / `ChevronDown` from lucide) for containers, empty space for primitives
     - Key name in a distinct color (e.g., `text-foreground font-medium`)
     - Colon separator in muted color
     - Type-colored value preview:
       - Strings: green, shown in quotes, truncated
       - Numbers: blue
       - Booleans: purple (`true`/`false`)
       - Null: gray italic
       - Objects: muted orange `{3 keys}`
       - Arrays: muted orange `[5 items]`
   - Row height: compact (~28px)
   - Hover: subtle `bg-accent` background
   - If node is in `loadingNodes` set, show a small spinner instead of chevron

5. Create `src/components/json-tree/JsonTreeViewer.tsx`:
   - Takes `rootNodes: TreeNodeInfo[]` as prop
   - Uses `useTreeData` hook
   - Renders react-arborist `<Tree>` component:
     - `data={treeData}`
     - `rowHeight={28}`
     - `overscanCount={20}`
     - `width` and `height` should fill parent — use `FillFlexParent` from react-arborist or a resize observer
     - `disableDrag={true}`, `disableDrop={true}`
   - Wire `onToggle` to `loadChildren` in the hook
   - Empty state when no data: centered message with `FileJson` icon + "Open a JSON file to explore"
   - Header bar above tree: shows node count, file name

6. Integrate `JsonTreeViewer` into `AppShell.tsx`:
   - Place in the left resizable panel
   - Pass `rootNodes` from `useFileState`

**Edge Cases & Gotchas:**
- react-arborist's API for lazy loading: Check the library's docs carefully. It may expect `children: null` to indicate "not loaded" or may use an `isLeaf` callback. If `children: null` doesn't work, the alternative is to return a placeholder child that triggers loading.
- Tree state updates must be immutable. When updating a deeply nested node's children, clone only along the path from root to modified node.
- For arrays with 100k+ elements, pagination is critical. Show first 500 items and a "Load more..." button/node. The synthetic "Load more" node should have a special `id` (e.g., `$.bigArray.__loadmore__500`) that the toggle handler recognizes.
- react-arborist's `Tree` component needs explicit `width` and `height`. The recommended approach is to wrap it in a flex container and use `FillFlexParent` or a `ResizeObserver` hook.
- The monospace font should be consistent across platforms: use `font-mono` Tailwind class which resolves to `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`.

**Verification:**
- Open a JSON file → root nodes appear in the tree viewer
- Click expand arrow on an object → children load from backend and appear (brief loading spinner on the node)
- Expand deeply nested nodes → each level loads on demand
- Scroll quickly through a large expanded array → smooth scrolling, no frame drops
- Primitive nodes show no expand arrow
- Each node shows correct color-coded type and preview
- Empty state shown when no file loaded

**Depends On:** Steps 4, 7, 8
**Blocks:** Step 12

---

### Step 10: Frontend — jq Query Editor

**Objective:** Build the jq query input with real-time validation, execution, and result streaming display.

**Context:**
- Step 5 provides the `run_jq_query` and `validate_jq_query` backend commands.
- Step 6 provides cancellation.
- The query editor sits in the top-right pane of the layout.

**Scope:**
- Create: `src/components/query/QueryEditor.tsx` — The jq input area
- Create: `src/components/query/useQueryExecution.ts` — Hook for query state management
- Modify: `src/components/layout/AppShell.tsx` — Integrate query editor

**Sub-tasks:**

1. Create `src/components/query/useQueryExecution.ts`:
   - State: `query: string`, `isValid: boolean | null`, `validationError: string | null`, `isRunning: boolean`, `results: QueryResultItem[]`, `resultCount: number`, `elapsedMs: number | null`, `error: string | null`
   - `QueryResultItem` type: `{ index: number; value: string; valueType: string }`
   - `setQuery(q: string)`: Updates query state. Debounce validation (300ms using `setTimeout`/`clearTimeout`).
   - Validation effect: When debounced query changes, call `tauriCommands.validateJqQuery(query)`. Update `isValid` and `validationError`.
   - `executeQuery()`:
     a. If already running, cancel first
     b. Clear previous results and error
     c. Call `tauriCommands.runJqQuery(query, onResult)`
     d. `onResult` callback handles each `QueryResult` variant:
       - `Compiling` → set `isRunning = true`
       - `Running` → (already running)
       - `Result` → append to results array (use functional state update)
       - `Complete` → set `isRunning = false`, set `resultCount` and `elapsedMs`
       - `Error` → set `error`, set `isRunning = false`
   - `cancelExecution()`: Call `tauriCommands.cancelQuery()`, set `isRunning = false`

2. Create `src/components/query/QueryEditor.tsx`:
   - Uses `useQueryExecution` hook
   - Layout:
     - Textarea (shadcn `Textarea`) with monospace font (`font-mono`), 3-4 rows
     - Placeholder: `"Type a jq expression... (e.g., .users[] | select(.age > 30))"`
     - Border color reflects validation: `border-green-500` when valid, `border-destructive` when invalid, default when empty or null
     - Error message below textarea (small, red, monospace) showing `validationError`
     - Action buttons row:
       - "Run" button (Play icon) — calls `executeQuery()`. Disabled when empty, invalid, or no file loaded.
       - "Cancel" button (Square/Stop icon) — visible only when `isRunning`. Calls `cancelExecution()`.
     - Status line:
       - When idle and no results: "Press Ctrl+Enter to run"
       - When running: "Running..." with a small spinner
       - When complete: `"{resultCount} results in {elapsedMs}ms"`
       - When error from execution: red error text
   - Keyboard handling:
     - `Ctrl+Enter` / `Cmd+Enter` → `executeQuery()`
     - `Escape` → `cancelExecution()` (only when running)
     - Regular `Enter` → newline in textarea (default behavior)

3. Integrate into `AppShell`:
   - Place `QueryEditor` in the top portion of the right panel
   - Ensure the hook state is accessible to both QueryEditor and ResultViewer (either lift state to AppShell or use a shared context)

**Edge Cases & Gotchas:**
- Debounce validation to avoid excessive IPC calls while typing. Clear the debounce timer on component unmount.
- The query `.` is valid but returns the entire file — which could be huge. The backend limits results to 10,000 items and 60 seconds (from Step 5/6). The frontend should show a "Results truncated" warning when `resultCount` exceeds display.
- Empty query should not trigger validation or execution (set `isValid = null`).
- If the user executes while a previous query is running, cancel the previous one first.
- Textarea should not submit on Enter (Enter adds newline for multi-line queries). Only `Ctrl+Enter` executes.
- Results array can grow large. Consider using a ref instead of state for accumulation, then batch-update state periodically (e.g., every 100 results).

**Verification:**
- Type `.name` → green border appears (valid)
- Type `.[[[` → red border, error tooltip shows compile error below
- Type `.users[]` + Ctrl+Enter → results stream in, count and time shown
- Click Cancel during a query → execution stops, results shown up to that point
- Query editor disabled when no file loaded

**Depends On:** Steps 5, 6, 7
**Blocks:** Step 11

---

### Step 11: Frontend — Result Viewer

**Objective:** Display jq query results in either a tree view (for complex JSON results) or raw text view (for primitives/simple lists).

**Context:**
- Step 10 provides query results as an array of `{ index, value (JSON string), valueType }`.
- Results can be: a single object/array (show in tree), multiple primitives (show as list), or mixed.

**Scope:**
- Create: `src/components/results/ResultViewer.tsx` — Main result display
- Create: `src/components/results/ResultList.tsx` — Virtualized list of result items
- Create: `src/components/results/RawJsonView.tsx` — Pretty-printed raw JSON for single/all results
- Modify: `src/components/layout/AppShell.tsx` — Integrate result viewer

**Sub-tasks:**

1. Create `src/components/results/ResultViewer.tsx`:
   - Takes props: `results: QueryResultItem[]`, `isRunning: boolean`, `resultCount: number`, `elapsedMs: number | null`, `error: string | null`
   - State: `viewMode: 'list' | 'raw'` — toggle between views
   - Header bar:
     - Result count + elapsed time (e.g., "42 results in 150ms")
     - View mode toggle: list icon / code icon (using shadcn Button with `variant="ghost"`)
     - "Copy All" button — copies all results as JSON to clipboard
   - Content:
     - If `error`: show error message in `text-destructive font-mono` with a card/box
     - If `results.length === 0` and not running: empty state "Run a jq query to see results"
     - If `viewMode === 'list'`: render `ResultList`
     - If `viewMode === 'raw'`: render `RawJsonView`

2. Create `src/components/results/ResultList.tsx`:
   - Virtualized list of result items
   - Use a simple approach: render results in a scrollable container with fixed-height rows
   - For v1, a basic virtualized list: only render items in the viewport + overscan. Can use `@tanstack/react-virtual` (already available as a dep of react-arborist) or implement simple windowing with `overflow-auto` and absolute positioning.
   - Each row: `index (muted) | value preview (monospace, color-coded by type)`
   - Clicking a row copies its value to clipboard (show toast confirmation)

3. Create `src/components/results/RawJsonView.tsx`:
   - Monospace `<pre>` block showing all results concatenated, each separated by `\n`
   - Basic syntax coloring using Tailwind:
     - Wrap in `ScrollArea` from shadcn for both horizontal and vertical scrolling
     - For v1, just show raw text without syntax highlighting (syntax highlighting is a nice-to-have that can use a library like `prism-react-renderer` later)
   - "Copy" button in top-right corner

4. Integrate into AppShell:
   - Place `ResultViewer` in the bottom portion of the right panel
   - Pass results and state from the shared query execution hook/state

**Edge Cases & Gotchas:**
- Results are stored as JSON strings. For the list view, just display the string directly (already formatted).
- "Copy All" should join results with `\n` — this matches jq's output format.
- For very large result sets (10,000 items), the raw view could be very large. Truncate display to first 1000 lines with a "... truncated" message. Copy All should still copy everything.
- The `ScrollArea` component from shadcn may need explicit height. Ensure it fills its parent panel.
- Handle the case where results are still streaming (isRunning = true) — show results accumulated so far with a "loading more..." indicator at the bottom.

**Verification:**
- Run `.name` on `{"name": "test"}` → shows `"test"` as a single result
- Run `.users[]` on an array → shows list of results
- Toggle between list and raw view
- "Copy All" button works (check clipboard content)
- Empty state shown when no results
- Error state shown when query fails

**Depends On:** Step 10
**Blocks:** Step 12

---

### Step 12: Integration — Wire Everything Together

**Objective:** Ensure end-to-end flow works, configure all Tauri capabilities/permissions, and handle the final integration details.

**Context:**
- All individual components (backend commands, frontend components) are built.
- This step connects them and ensures permissions, window sizing, and app metadata are correct.

**Scope:**
- Modify: `src-tauri/capabilities/default.json` — All required permissions
- Modify: `src-tauri/tauri.conf.json` — Window size, title, app metadata
- Modify: `src/components/layout/AppShell.tsx` — Final wiring of all components
- Modify: `src/App.tsx` — Error boundary
- Create: `src/components/ErrorBoundary.tsx` — React error boundary

**Sub-tasks:**

1. Update `src-tauri/capabilities/default.json` with all required permissions:
   ```json
   {
     "permissions": [
       "core:default",
       "opener:default",
       "dialog:default",
       "dialog:allow-open",
       "dialog:allow-save"
     ]
   }
   ```

2. Update `src-tauri/tauri.conf.json`:
   - Window: `"width": 1200, "height": 800` (larger default for a developer tool)
   - Add: `"minWidth": 800, "minHeight": 600`
   - Verify title is `"jq-desktop"`

3. Create `src/components/ErrorBoundary.tsx`:
   - Standard React class component error boundary
   - Catches rendering errors, shows styled error message
   - "Reload" button that calls `window.location.reload()`
   - Style: centered card with error icon, message, and button

4. Update `src/App.tsx`:
   - Wrap `<AppShell />` in `<ErrorBoundary>`
   - Ensure `<Toaster />` from sonner is rendered (theme set to "dark")

5. Final wiring in `AppShell.tsx`:
   - Verify `useFileState` hook is used at this level and state flows correctly:
     - `rootNodes` → `JsonTreeViewer`
     - `fileInfo` → `Toolbar`
     - `isLoading` / `loadProgress` → `LoadingOverlay`
   - Verify query execution state flows:
     - Query editor manages its own state via `useQueryExecution`
     - Results flow to `ResultViewer`
   - Verify toolbar actions:
     - "Open File" → `openFile()`
     - "Close" → `closeFile()` + clear query results
   - Verify status bar shows current context

6. Full end-to-end smoke test:
   - Open app → empty state in all panels
   - Click Open File → dialog → select JSON file → progress → tree loads
   - Expand nodes → children lazy-load
   - Type jq query → validation works (green/red border)
   - Ctrl+Enter → results stream in
   - Cancel query → stops
   - Close file → everything resets

**Edge Cases & Gotchas:**
- If any permission is missing in capabilities, Tauri will silently deny the operation. Test dialog opening specifically.
- The dark mode class must be on `<html>` not `<body>` for shadcn variables to work with the `.dark` selector.
- Window `minWidth`/`minHeight` prevents layout breakage on small windows.
- When closing a file, also cancel any running query and clear query results.

**Verification:**
- Full end-to-end flow works as described in sub-task 6.
- `bun tauri dev` opens the app and all features work.
- `bun tauri build` compiles successfully (produces an installable binary).
- No console errors during normal operation.

**Depends On:** Steps 8, 9, 10, 11
**Blocks:** Step 13

---

### Step 13: Quality — Error States, Edge Cases, and UX Polish

**Objective:** Handle all error states gracefully, add keyboard shortcuts, and polish the user experience.

**Context:**
- The full application is functional. This step adds production quality.

**Scope:**
- Create: `src/hooks/useKeyboardShortcuts.ts` — Global keyboard shortcuts
- Modify: Various frontend components for error states and polish
- Modify: `src/components/json-tree/JsonTreeNode.tsx` — Copy path/value actions
- Modify: `src/components/layout/Toolbar.tsx` — Keyboard shortcut hints

**Sub-tasks:**

1. Implement global keyboard shortcuts in `src/hooks/useKeyboardShortcuts.ts`:
   - `Ctrl+O` / `Cmd+O` → Open file dialog
   - `Ctrl+Enter` / `Cmd+Enter` → Execute jq query (already handled in QueryEditor, but ensure it works globally when query editor is not focused by focusing the editor first)
   - `Escape` → Cancel running query
   - `Ctrl+W` / `Cmd+W` → Close current file
   - Register via `useEffect` with `window.addEventListener('keydown', handler)` — clean up on unmount
   - Prevent default browser behavior for these shortcuts (e.g., `Ctrl+O` normally opens browser file dialog in the webview)

2. Add polished empty states to all panels:
   - JSON Tree (no file): Centered `FileJson` icon (lucide, large, muted), "Open a JSON file to explore" text, "Open File" button below
   - Query Editor (no file): Disabled textarea with placeholder "Load a file first"
   - Result Viewer (no results): Centered `Search` icon (lucide), "Run a jq query to see results"
   - Result Viewer (error): Styled error card with `AlertCircle` icon, monospace error text

3. Add error toast notifications for all failure cases:
   - File open failure → toast with error message
   - JSON parse failure → toast with "Invalid JSON" + first line of error
   - jq compile error → inline in query editor (red border + error text below), NOT a toast
   - jq runtime error → shown in result viewer error area, NOT a toast

4. Add "Copy Path" functionality to tree nodes:
   - On hover, show a small copy icon button on the right side of the node row
   - Clicking copies the JSON path (e.g., `$.users[0].address.city`) to clipboard
   - Show brief toast: "Path copied to clipboard"

5. Add "Copy Value" functionality to tree nodes:
   - Second icon button (or combine into a dropdown menu)
   - Calls `tauriCommands.getNodeValue(path)` to get the full value
   - Copies to clipboard, shows toast
   - For large values, the backend already truncates at 1MB

6. Add file size warning:
   - In `useFileState.openFile()`, before calling `loadFile`, check file size (can get from the dialog result or add a separate `get_file_size` command)
   - If file > 500MB, show a warning toast: "Large file (X MB). Loading may take a while."
   - Don't block — just inform

7. Update toolbar buttons with keyboard shortcut hints in tooltips:
   - "Open File" tooltip: "Open JSON file (Ctrl+O)"
   - "Close" tooltip: "Close file (Ctrl+W)"
   - Run button tooltip: "Execute query (Ctrl+Enter)"

8. Disable context menu in the webview (prevents default browser right-click menu):
   - In `tauri.conf.json`, under app.windows, ensure right-click doesn't show the default context menu
   - Or add `oncontextmenu="event.preventDefault()"` to the root element

**Edge Cases & Gotchas:**
- `Ctrl+O` and other browser shortcuts must be prevented with `e.preventDefault()` before they trigger default behavior.
- Clipboard API (`navigator.clipboard.writeText`) works in Tauri's webview without HTTPS.
- Multiple toasts shouldn't stack excessively — set `duration: 3000` and let sonner handle queuing.
- The "Copy Path" hover button should not trigger on every mouse move — use CSS hover state, not React state, for the show/hide logic.

**Verification:**
- All keyboard shortcuts work correctly
- All error states show appropriate messages (no blank screens)
- Copy path/value works and shows confirmation toast
- Large file warning appears for files > 500MB
- Tooltips show shortcut hints
- No uncaught errors in any error path

**Depends On:** Step 12
**Blocks:** None (this is the final step)

---

## Appendix A: Final File Structure

```
jq-desktop/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── components.json
├── PLAN.md
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── vite-env.d.ts
│   ├── types/
│   │   └── index.ts
│   ├── lib/
│   │   └── utils.ts
│   ├── hooks/
│   │   ├── useFileState.ts
│   │   └── useKeyboardShortcuts.ts
│   ├── services/
│   │   └── tauri-commands.ts
│   ├── components/
│   │   ├── ui/                    (shadcn components)
│   │   │   ├── button.tsx
│   │   │   ├── resizable.tsx
│   │   │   ├── input.tsx
│   │   │   ├── scroll-area.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── tooltip.tsx
│   │   │   ├── textarea.tsx
│   │   │   └── sonner.tsx
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   └── StatusBar.tsx
│   │   ├── json-tree/
│   │   │   ├── JsonTreeViewer.tsx
│   │   │   ├── JsonTreeNode.tsx
│   │   │   ├── useTreeData.ts
│   │   │   └── tree-utils.ts
│   │   ├── query/
│   │   │   ├── QueryEditor.tsx
│   │   │   └── useQueryExecution.ts
│   │   ├── results/
│   │   │   ├── ResultViewer.tsx
│   │   │   ├── ResultList.tsx
│   │   │   └── RawJsonView.tsx
│   │   ├── LoadingOverlay.tsx
│   │   └── ErrorBoundary.tsx
│   └── assets/
├── src-tauri/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── error.rs
│       ├── state.rs
│       ├── json_store.rs
│       ├── jq_engine.rs
│       └── commands/
│           ├── mod.rs
│           ├── file.rs
│           ├── tree.rs
│           └── query.rs
└── public/
    └── tauri.svg
```

## Appendix B: Key Dependencies

### Rust (Cargo.toml)
| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | `2` | Application framework |
| `tauri-plugin-opener` | `2` | URL/file opening |
| `tauri-plugin-dialog` | `2` | Native file dialogs |
| `serde` | `1` (derive) | Serialization |
| `serde_json` | `1` | JSON parsing & manipulation |
| `jaq-core` | `2` | jq filter compilation & execution |
| `jaq-std` | `2` | jq standard library functions |
| `jaq-json` | `2` | jq JSON value type |
| `tokio` | `1` (full) | Async runtime |

### Frontend (package.json)
| Package | Purpose |
|---------|---------|
| `react` / `react-dom` | UI framework (v19) |
| `@tauri-apps/api` | Tauri IPC (invoke, Channel) |
| `@tauri-apps/plugin-dialog` | File dialog frontend API |
| `tailwindcss` | Styling (v4) |
| `shadcn` (+ ui components) | UI component library |
| `react-arborist` | Virtualized tree view |
| `lucide-react` | Icons |

## Appendix C: Parallelization Guide

Steps that can be executed in parallel:

- **Steps 2–6** (Rust backend) are mostly sequential (each builds on previous)
- **Step 7** (Frontend scaffolding) is **fully independent** — can run in parallel with Steps 1–6
- **Steps 4 and 5** are independent of each other (both depend only on Step 2), so they can be done in parallel
- **Step 8** requires Steps 3 + 7
- **Step 9** requires Steps 4 + 8
- **Step 10** requires Steps 5 + 6 + 7
- **Step 11** requires Step 10
- **Steps 12–13** are sequential, after all prior steps

Optimal execution tracks:
```
Backend:    1 → 2 → 3 ─────────────────────────────→ ↘
                  ├→ 4 ──────────────────────────────→ ↘
                  └→ 5 → 6 ──────────────────────────→ ↘
                                                        12 → 13
Frontend:   7 ──────→ 8 (needs 3+7) → 9 (needs 4+8) → ↗
                      └→ 10 (needs 5+6+7) → 11 ──────→ ↗
```
