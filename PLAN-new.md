# Plan: Add Tree View for JQ Output Results

---

## Section 1: High-Level Overview

### 1.1 — Goal Statement

Add a new "Tree" view tab to the JQ results panel that allows users to explore query output as an interactive, expandable tree — identical in look and behavior to the existing JSON tree viewer on the left side of the workspace. This tree view must efficiently handle multi-MB JQ output by leveraging the same lazy-loading, paginated, virtualized architecture already proven in the source file tree.

### 1.2 — Approach Summary

**Architecture:** Store JQ query results as parsed `serde_json::Value` objects in the Rust backend's `AppState`. Add two new Tauri commands (`expand_result_node` and `get_result_node_value`) that reuse the existing tree navigation logic from `JsonStore` to serve tree metadata on demand. On the frontend, add a "Tree" tab to `ResultViewer` that renders a new `ResultTreeViewer` component — a thin wrapper around the existing `JsonTreeNode` renderer and `react-arborist` `<Tree>` component.

**Key design decisions:**
- **Backend-owned data:** JQ results stay in Rust memory. The frontend only receives lightweight `TreeNodeInfo` metadata, never the full parsed JSON. This is critical for multi-MB output.
- **Reuse existing tree infrastructure:** The `JsonTreeNode` component, `tree-utils.ts` helpers, and `react-arborist` library are reused directly. Only the data-fetching hook changes (calls `expand_result_node` instead of `expand_node`).
- **Flat list of expandable results:** When a query produces multiple results, the tree shows a numbered top-level list (Result 0, Result 1, ...). Each result that is an object or array can be expanded. Primitives display inline.
- **Third tab:** "Tree" is added alongside "List" and "Raw" — no existing views are removed.

### 1.3 — Decisions Log

- **Decision:** Store JQ results in Rust backend, not in frontend JS heap.
  - **Alternatives considered:** (A) Parse JSON in frontend with `JSON.parse`, (B) Store in backend.
  - **Rationale:** Multi-MB results would cause OOM or jank in the JS heap. The backend already has proven tree navigation code. Keeping data in Rust matches the existing architecture.

- **Decision:** Add "Tree" as a third tab, not replacing List or Raw.
  - **Alternatives considered:** (A) Replace List, (B) Replace both, (C) Add as third tab.
  - **Rationale:** Users may prefer the compact List view for simple results (strings, numbers). Raw view is useful for copy-paste workflows. Adding a tab preserves all existing functionality.

- **Decision:** Display multiple results as a flat numbered list at the top level.
  - **Alternatives considered:** (A) Flat list, (B) Merged into virtual root array, (C) Only show tree for single results.
  - **Rationale:** A flat list is the most intuitive mapping — each result is independently expandable. A virtual array would add a confusing extra nesting level. Restricting to single results would be too limiting.

- **Decision:** Reuse `JsonTreeNode` component directly (not fork it).
  - **Alternatives considered:** (A) Reuse as-is, (B) Fork and customize.
  - **Rationale:** The node renderer is already generic — it renders based on `TreeNode` data, not on where the data comes from. The only difference is the copy-value action needs to call a different backend command, which can be handled via a callback prop.

- **Decision:** Extract tree navigation helpers from `JsonStore` into standalone functions.
  - **Alternatives considered:** (A) Duplicate the logic in a new `ResultStore`, (B) Extract into shared functions.
  - **Rationale:** The `get_children` and `get_value_at_path` logic operates on `&Value` and has no dependency on `JsonStore` fields. Extracting avoids code duplication and makes both stores use the same tested logic.

- **Decision:** Copy path and copy value buttons behave identically to the left-side tree.
  - **Alternatives considered:** (A) Match left panel, (B) Copy value only.
  - **Rationale:** Consistency. The path format (`$result[0].users[1].name`) is still useful for understanding structure.

### 1.4 — Assumptions & Open Questions

**Assumptions:**
- The existing 10,000 result limit in `run_jq_query` is acceptable. Storing 10,000 parsed `Value` objects in Rust memory is feasible (even if each is a few KB, total is ~100MB worst case, which is fine for a desktop app).
- The `react-arborist` library handles the case where the top-level tree data changes entirely (results cleared and repopulated) without issues — this is already proven by the left-side tree when switching files.
- The result store can be cleared and repopulated on each query execution without race conditions, since query execution is serialized (only one query runs at a time, enforced by the cancel-before-run pattern).

**Open Questions (non-blocking):**
- Should "Tree" be the default tab when results contain objects/arrays? The plan defaults to keeping "List" as default for now, since it's the existing behavior. This can be changed later with a one-line edit.
- Should there be a size threshold above which the Tree tab shows a warning? (e.g., "Results contain 10,000 items, tree may be slow to navigate"). Not included in this plan but easy to add.

### 1.5 — Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Memory pressure from storing parsed results in Rust | Low | Medium | The 10,000 result limit caps memory. Each result is already bounded to 1M chars. Clearing results on each new query prevents accumulation. |
| Race condition: user runs new query while expanding a result tree node | Low | Low | The result store is cleared atomically at the start of each query. Frontend tree state resets when results change. Stale expand requests will fail gracefully with "result not found" errors. |
| `react-arborist` performance with 10,000 top-level nodes | Low | Medium | Already proven: the left-side tree handles this via virtualization (28px rows, 20-row overscan). The result tree uses identical configuration. |
| Path collision between source tree and result tree | None | None | Result tree paths use a different prefix (`$result[N]` vs `$`) and call different backend commands. No collision possible. |
| Breaking existing List/Raw views | Low | High | The existing `ResultViewer`, `ResultList`, and `RawJsonView` components are not modified — only the parent component gains a new tab and child. |

### 1.6 — Step Sequence Overview

1. **Extract tree navigation helpers in Rust** — Move `get_children`, `get_value_at_path`, and helper functions out of `JsonStore` into a shared `tree_nav` module.
2. **Add `ResultStore` to Rust backend** — Create a new store for parsed JQ results with tree navigation support.
3. **Add new Tauri commands** — `expand_result_node` and `get_result_node_value` commands that operate on the result store.
4. **Modify `run_jq_query` to store parsed results** — Parse each JQ output into `serde_json::Value` and store in `ResultStore`.
5. **Add frontend Tauri command wrappers** — Add `expandResultNode` and `getResultNodeValue` to `tauri-commands.ts`.
6. **Update TypeScript types** — Add new types for result tree data flow.
7. **Create `useResultTreeData` hook** — Adapt `useTreeData` for result tree navigation using the new backend commands.
8. **Create `ResultTreeViewer` component** — Build the tree view component for results, reusing `JsonTreeNode`.
9. **Integrate Tree tab into `ResultViewer`** — Add "Tree" as a third view mode tab.
10. **Wire result store lifecycle into query execution** — Ensure results are cleared/populated at the right times.

---

## Section 2: Step-by-Step Execution Plan

### Step 1: Extract Tree Navigation Helpers in Rust

**Objective:** Move the generic tree navigation logic (path resolution, child enumeration, node info generation) out of `JsonStore` into a shared `tree_nav` module so both `JsonStore` and the new `ResultStore` can use it.

**Context:**
- Currently, `JsonStore` in `src-tauri/src/json_store.rs` contains both state management (storing the loaded file) and tree navigation logic (path parsing, child enumeration, node info creation).
- The tree navigation logic operates purely on `&serde_json::Value` references and has no dependency on `JsonStore` fields.
- We need this logic to be reusable for the result store.

**Scope:**
- Create new file: `src-tauri/src/tree_nav.rs`
- Modify: `src-tauri/src/json_store.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod tree_nav`)

**Sub-tasks:**

1. Create `src-tauri/src/tree_nav.rs` with the following items moved from `json_store.rs`:
   - The `TreeNodeInfo` struct definition (lines 8-17 of `json_store.rs`)
   - The constants `ROOT_ARRAY_PREVIEW_LIMIT` and `STRING_PREVIEW_LIMIT`
   - All standalone helper functions:
     - `value_to_node_info(parent_path, key, value) -> TreeNodeInfo`
     - `value_to_indexed_node_info(parent_path, index, value) -> TreeNodeInfo`
     - `value_type_name(value) -> &'static str`
     - `preview_for_value(value) -> String`
     - `truncate_chars(value, max_chars) -> String`
     - `child_count(value) -> Option<usize>`
     - `child_count_for(value) -> usize`
     - `has_children(value) -> bool`
   - New public functions extracted from `JsonStore` methods:
     - `pub fn get_children_of_value(value: &Value, parent_path: &str, offset: usize, limit: usize) -> Result<(Vec<TreeNodeInfo>, usize), AppError>` — the logic currently in `JsonStore::get_children` lines 60-92
     - `pub fn get_value_at_path(root: &Value, path: &str) -> Result<&Value, AppError>` — the logic currently in `JsonStore::get_value_at_path` lines 94-176
     - `pub fn get_root_nodes_of_value(root: &Value) -> Vec<TreeNodeInfo>` — the logic currently in `JsonStore::get_root_nodes` lines 27-52, but operating on a `&Value` parameter instead of `self.data`

2. Update `json_store.rs`:
   - Remove the moved functions and constants
   - Remove the `TreeNodeInfo` struct (it now lives in `tree_nav.rs`)
   - Add `use crate::tree_nav::{TreeNodeInfo, get_children_of_value, get_value_at_path, get_root_nodes_of_value};`
   - Rewrite `JsonStore::get_root_nodes()` to delegate: call `get_root_nodes_of_value(self.data.as_ref().ok_or(AppError::NoFileLoaded)?)` 
   - Rewrite `JsonStore::get_children()` to delegate: call `get_children_of_value(self.get_value_at_path_internal(path)?, path, offset, limit)` — note: `get_value_at_path` on `JsonStore` should now delegate to the free function
   - Rewrite `JsonStore::get_value_at_path()` to delegate: call `tree_nav::get_value_at_path(self.data.as_ref().ok_or(AppError::NoFileLoaded)?, path)`
   - Re-export `TreeNodeInfo` from `json_store.rs` for backward compatibility: `pub use crate::tree_nav::TreeNodeInfo;`

3. Add `mod tree_nav;` to `src-tauri/src/lib.rs`.

4. Ensure all existing imports of `TreeNodeInfo` from `json_store` continue to work (the re-export handles this). Check `commands/tree.rs` line 1 which imports `use crate::json_store::TreeNodeInfo;`.

**Edge Cases & Gotchas:**
- The `get_value_at_path` function currently returns `Result<&Value, AppError>` with a lifetime tied to `&self`. When extracted, the lifetime ties to the `root: &Value` parameter instead. This is a straightforward change but must be verified.
- The `NoFileLoaded` error variant is specific to `JsonStore`. The extracted functions should use `ParseError("No data provided")` or accept a guaranteed `&Value` (not `Option`). The `NoFileLoaded` check stays in `JsonStore`'s wrapper methods.

**Verification:**
- Run `cargo test` in `src-tauri/` — all existing tests in `json_store.rs` and `commands/tree.rs` must pass.
- Run `cargo build` — no compilation errors.

**Depends On:** None
**Blocks:** Step 2, Step 3

---

### Step 2: Add `ResultStore` to Rust Backend

**Objective:** Create a `ResultStore` struct that holds parsed JQ query results and provides tree navigation over them.

**Context:**
- Step 1 extracted tree navigation into `tree_nav.rs`.
- We need a store that holds `Vec<serde_json::Value>` (the parsed JQ results) and supports expanding individual result nodes.
- The store must be clearable (on each new query) and thread-safe (behind a Mutex in AppState).

**Scope:**
- Create new file: `src-tauri/src/result_store.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod result_store`)

**Sub-tasks:**

1. Create `src-tauri/src/result_store.rs` with:
   - A `ResultStore` struct:
     ```
     pub struct ResultStore {
         results: Vec<Value>,
     }
     ```
   - `impl Default for ResultStore` — initializes with empty vec.
   - `pub fn clear(&mut self)` — clears the results vec.
   - `pub fn push(&mut self, value: Value)` — appends a parsed result.
   - `pub fn len(&self) -> usize` — returns count.
   - `pub fn get_result_root_nodes(&self, offset: usize, limit: usize) -> (Vec<TreeNodeInfo>, usize)` — returns top-level result nodes with pagination. Each result becomes a `TreeNodeInfo` with:
     - `id`: `"$result[{index}]"` (e.g., `"$result[0]"`, `"$result[1]"`)
     - `key`: `"{index}"` (the result index as a string)
     - `value_type`: the type of the result value
     - `preview`: the preview string (using `tree_nav` helpers)
     - `child_count`: child count if object/array
     - `has_children`: true if object/array with children
     - Returns `(nodes, total_count)` for pagination support.
   - `pub fn get_children(&self, path: &str, offset: usize, limit: usize) -> Result<(Vec<TreeNodeInfo>, usize), AppError>` — navigates to a result node by path and returns its children. Path format: `"$result[{index}]"` for root, `"$result[{index}].key"` or `"$result[{index}][N]"` for nested. This method:
     - Parses the result index from the path prefix `$result[N]`
     - Gets the corresponding `Value` from `self.results[N]`
     - Strips the `$result[N]` prefix to get the sub-path (or uses `$` if at root of that result)
     - Delegates to `tree_nav::get_children_of_value()` for the actual navigation, passing the full path for ID generation
   - `pub fn get_value_at_path(&self, path: &str) -> Result<&Value, AppError>` — resolves a path to a value reference. Same path parsing as above, delegates to `tree_nav::get_value_at_path()`.
   - A private helper `fn parse_result_path(path: &str) -> Result<(usize, &str), AppError>` that extracts the result index and remaining sub-path from a path string like `"$result[3].users[0].name"` → `(3, "$.users[0].name")`. If the path is just `"$result[3]"`, the sub-path is `"$"`.

2. Add `mod result_store;` to `src-tauri/src/lib.rs`.

3. Update `src-tauri/src/state.rs`:
   - Add `use crate::result_store::ResultStore;`
   - Add field to `AppState`: `pub result_store: Mutex<ResultStore>`
   - Update `Default` impl to initialize: `result_store: Mutex::new(ResultStore::default())`

**Edge Cases & Gotchas:**
- **Path format:** Result paths use `$result[N]` prefix to distinguish from source file paths (`$`). The `tree_nav::get_children_of_value` function needs the full path for generating child node IDs. When calling it, pass the full result path (e.g., `"$result[3].users"`) as the `parent_path` so child IDs are correctly formed (e.g., `"$result[3].users[0]"`).
- **Thread safety:** `ResultStore` is behind a `Mutex` in `AppState`, same as `JsonStore`. The mutex is held briefly for each expand/get-value call.
- **Index bounds:** `get_children` and `get_value_at_path` must check that the parsed result index is within `self.results.len()` and return a clear error if not (e.g., `AppError::ParseError("Result index N out of range")`).
- **Empty results:** When no query has been run, `results` is empty. `get_result_root_nodes` returns `([], 0)`.

**Verification:**
- Write unit tests in `result_store.rs`:
  - Test `push` + `get_result_root_nodes` returns correct metadata
  - Test `get_children` navigates into a result object
  - Test `get_value_at_path` resolves nested paths
  - Test `clear` empties the store
  - Test out-of-bounds index returns error
- Run `cargo test` — all tests pass.

**Depends On:** Step 1
**Blocks:** Step 3, Step 4

---

### Step 3: Add New Tauri Commands

**Objective:** Expose `expand_result_node` and `get_result_node_value` as Tauri commands so the frontend can navigate the result tree.

**Context:**
- Step 2 created `ResultStore` with tree navigation methods.
- We need Tauri commands that mirror the existing `expand_node` and `get_node_value` but operate on the result store.

**Scope:**
- Create new file: `src-tauri/src/commands/result_tree.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register new commands)

**Sub-tasks:**

1. Create `src-tauri/src/commands/result_tree.rs` with two commands:

   - `expand_result_node(path: String, offset: Option<usize>, limit: Option<usize>, state: tauri::State<'_, AppState>) -> Result<ExpandResult, String>`:
     - Uses the same `ExpandResult` struct from `commands/tree.rs` (move it to a shared location or re-import).
     - If `path` is `"$result"` (the virtual root), calls `result_store.get_result_root_nodes(offset, limit)` and wraps in `ExpandResult`.
     - Otherwise, calls `result_store.get_children(path, offset, limit)` and wraps in `ExpandResult`.
     - Default offset: 0, default limit: 500 (same constants as `commands/tree.rs`).

   - `get_result_node_value(path: String, state: tauri::State<'_, AppState>) -> Result<String, String>`:
     - Calls `result_store.get_value_at_path(path)`.
     - Serializes with `serde_json::to_string_pretty`.
     - Truncates to 1MB (same as `get_node_value`).

2. Move the `ExpandResult` struct from `commands/tree.rs` to a shared location. Options:
   - Move to `tree_nav.rs` (recommended, since it's a tree navigation type).
   - Or keep in `commands/tree.rs` and have `commands/result_tree.rs` import it.
   - The simplest approach: move `ExpandResult` to `tree_nav.rs` and have both command files import from there.

3. Update `src-tauri/src/commands/mod.rs`: add `pub mod result_tree;`.

4. Register the new commands in `src-tauri/src/lib.rs` invoke_handler:
   - Add `commands::result_tree::expand_result_node`
   - Add `commands::result_tree::get_result_node_value`

**Edge Cases & Gotchas:**
- The `ExpandResult` struct has `#[serde(rename_all = "camelCase")]` — ensure this is preserved when moving.
- The truncation logic for `get_result_node_value` should reuse the `truncate_utf8_bytes` function from `commands/tree.rs`. Consider moving it to a shared utility or `tree_nav.rs`.

**Verification:**
- Run `cargo build` — compiles without errors.
- Run `cargo test` — all existing tests pass.
- Manually verify the new commands are registered by checking the `generate_handler!` macro includes them.

**Depends On:** Step 2
**Blocks:** Step 5

---

### Step 4: Modify `run_jq_query` to Store Parsed Results

**Objective:** When a JQ query executes, parse each result string into `serde_json::Value` and store it in `ResultStore` for tree navigation.

**Context:**
- Currently, `run_jq_query` in `commands/query.rs` streams results as strings via a channel.
- We need to additionally parse each result and store it in `ResultStore`.
- The result store must be cleared at the start of each query.

**Scope:**
- Modify: `src-tauri/src/commands/query.rs`

**Sub-tasks:**

1. At the beginning of `run_jq_query` (after `state.reset_cancellation()`), clear the result store:
   ```
   state.result_store.lock().map_err(...)?.clear();
   ```

2. In the result emission loop (lines 71-97), after creating the `value` string and before sending `QueryResult::Result`, parse the value and store it:
   - Attempt `serde_json::from_str::<Value>(&output.value)` (use the original `output.value`, not the truncated one).
   - If parsing succeeds, push the `Value` into the result store: `state.result_store.lock().map_err(...)?.push(parsed_value);`
   - If parsing fails (unlikely since jaq outputs valid JSON), still send the string result but don't store a tree-navigable value. Log or silently skip.

3. Also clear the result store in the error paths (when query fails to compile or execute), so stale results from a previous query don't persist.

4. Clear the result store in `cancel_query` command as well, since cancelled results are incomplete.

**Edge Cases & Gotchas:**
- **Mutex contention:** The result store mutex is locked briefly for each `push()` call. With 10,000 results, this is 10,000 brief lock acquisitions. This is fine — each lock/unlock is nanoseconds.
- **Memory:** Storing 10,000 parsed `Value` objects. Worst case: each result is 1MB of JSON → 10GB. This is unrealistic in practice. The 1M char truncation on the *string* representation doesn't affect the parsed value (we parse from `output.value` which is the original). However, the `JqEngine::execute` already collects all results into a `Vec<JqOutput>` in memory, so the parsed values are bounded by what jaq can produce.
- **Parse failure:** The `output.value` comes from `jaq_json::Val::to_string()` which produces valid JSON. Parse failure should be impossible, but handle it gracefully by skipping the store for that result.
- **Ordering:** Results must be stored in the same order as they're emitted (index 0, 1, 2...). Since the loop is sequential, this is guaranteed.

**Verification:**
- Run `cargo test` — existing query tests pass.
- Add a test that runs a query, then verifies `result_store` contains the expected number of parsed values.

**Depends On:** Step 2
**Blocks:** Step 10

---

### Step 5: Add Frontend Tauri Command Wrappers

**Objective:** Add TypeScript functions to call the new `expand_result_node` and `get_result_node_value` Tauri commands.

**Context:**
- Step 3 added the backend commands.
- The frontend needs wrapper functions in `tauri-commands.ts` following the existing pattern.

**Scope:**
- Modify: `src/services/tauri-commands.ts`

**Sub-tasks:**

1. Add `expandResultNode` function:
   ```
   export async function expandResultNode(
     path: string,
     offset?: number,
     limit?: number,
   ): Promise<ExpandResult> {
     return invoke<ExpandResult>("expand_result_node", { path, offset, limit });
   }
   ```
   This mirrors the existing `expandNode` function exactly, just calling a different command.

2. Add `getResultNodeValue` function:
   ```
   export async function getResultNodeValue(path: string): Promise<string> {
     return invoke<string>("get_result_node_value", { path });
   }
   ```
   This mirrors the existing `getNodeValue` function.

**Edge Cases & Gotchas:**
- The `ExpandResult` type is already imported in `tauri-commands.ts` (line 3). No new type imports needed.

**Verification:**
- TypeScript compiles without errors (`npm run build` or `npx tsc --noEmit`).

**Depends On:** Step 3
**Blocks:** Step 7

---

### Step 6: Update TypeScript Types

**Objective:** Add any new TypeScript types needed for the result tree data flow.

**Context:**
- The existing `TreeNodeInfo`, `ExpandResult`, and `TreeNode` types are sufficient for the tree structure itself.
- We need a type to represent the result tree's root-level data that flows from `useQueryExecution` to the tree viewer.

**Scope:**
- Modify: `src/types/index.ts`
- Modify: `src/components/query/useQueryExecution.ts`

**Sub-tasks:**

1. In `src/types/index.ts`, no new types are strictly needed — the existing `TreeNodeInfo` and `ExpandResult` types work for result tree nodes too.

2. In `src/components/query/useQueryExecution.ts`, add a `resultTreeReady` boolean to `UseQueryExecutionReturn`:
   - Add state: `const [resultTreeReady, setResultTreeReady] = useState(false);`
   - Set to `false` at the start of `executeQuery` (when clearing results).
   - Set to `true` when `QueryResult::Complete` is received (in `handleQueryResult`).
   - Set to `false` in `reset()`.
   - Add to the return object.
   - This flag tells the `ResultTreeViewer` when it's safe to start loading the tree (all results are stored in the backend).

**Edge Cases & Gotchas:**
- Setting `resultTreeReady` to `true` only on `Complete` means the tree won't be available during streaming. This is intentional — the result store is being populated during streaming, and starting tree navigation mid-stream could show incomplete data. The List and Raw views continue to show streaming results in real-time.
- If the query errors, `resultTreeReady` stays `false` (the error handler doesn't set it to true). This is correct — there's nothing to tree-view on error.

**Verification:**
- TypeScript compiles without errors.

**Depends On:** None (can be done in parallel with Steps 1-5)
**Blocks:** Step 7, Step 8

---

### Step 7: Create `useResultTreeData` Hook

**Objective:** Create a React hook that manages tree state for the result tree, using the new backend commands for data fetching.

**Context:**
- The existing `useTreeData` hook in `src/components/json-tree/useTreeData.ts` is tightly coupled to the `expandNode` Tauri command (imported directly on line 3).
- We need a similar hook that calls `expandResultNode` instead.
- The approach: make the existing `useTreeData` hook accept the expand function as a parameter, OR create a new hook that duplicates the pattern with different commands.

**Scope:**
- Create new file: `src/components/results/useResultTreeData.ts`
- The existing `useTreeData.ts` is NOT modified (to avoid risk to the working left-side tree).

**Sub-tasks:**

1. Create `src/components/results/useResultTreeData.ts` that implements a hook with this signature:
   ```
   function useResultTreeData(resultCount: number, resultTreeReady: boolean): UseResultTreeDataReturn
   ```
   Where `UseResultTreeDataReturn` has the same shape as `UseTreeDataResult` from `useTreeData.ts`:
   ```
   {
     treeData: TreeNode[];
     loadingNodeIds: Set<string>;
     loadChildren: (nodeId: string) => Promise<void>;
     activateNode: (nodeId: string) => Promise<void>;
   }
   ```

2. The hook's behavior:
   - When `resultTreeReady` becomes `true`, call `expandResultNode("$result", 0, TREE_PAGE_SIZE)` to load the initial top-level result nodes.
   - Convert the returned `TreeNodeInfo[]` to `TreeNode[]` using `batchConvert` from `tree-utils.ts`.
   - If there are more results than `TREE_PAGE_SIZE`, append a "Load more..." node.
   - `loadChildren(nodeId)`: calls `expandResultNode(nodeId, 0, TREE_PAGE_SIZE)` and updates the tree state immutably — same pattern as `useTreeData.loadChildrenBatch`.
   - `activateNode(nodeId)`: handles "Load more..." nodes — same pattern as `useTreeData.activateNode`.
   - When `resultTreeReady` becomes `false` (new query starting), reset tree data to empty.

3. Import and use the helper functions from `tree-utils.ts`:
   - `batchConvert`, `createLoadMoreNode`, `isLoadMoreNode`, `TREE_PAGE_SIZE`, `type TreeNode`
   - These are already exported from `src/components/json-tree/tree-utils.ts`.

4. Import `expandResultNode` from `~/services/tauri-commands`.

5. Reuse the `findNode` and `updateNode` helper functions. These are currently private in `useTreeData.ts`. Options:
   - **Recommended:** Copy them into `useResultTreeData.ts`. They're small (30 lines each) and pure functions. Duplication is acceptable here to avoid modifying the existing file.
   - Alternative: Extract to `tree-utils.ts` and import in both hooks. This is cleaner but modifies an existing file.

**Edge Cases & Gotchas:**
- **Initial load:** Unlike the left-side tree which receives `rootNodes` as a prop, the result tree needs to fetch its root nodes from the backend. The hook should trigger this fetch when `resultTreeReady` transitions from `false` to `true`.
- **Race condition:** If the user runs a new query while the initial root node fetch is in flight, the `resultTreeReady` flag will flip to `false`, and the hook should discard the stale response. Use a ref-based run ID (similar to `validationRunId` in `useQueryExecution.ts`) to detect stale responses.
- **Empty results:** If `resultCount` is 0 and `resultTreeReady` is true (query completed with no results), the tree data should be empty `[]`.

**Verification:**
- TypeScript compiles without errors.
- The hook can be tested by rendering the `ResultTreeViewer` (Step 8) and verifying tree nodes appear after a query.

**Depends On:** Step 5, Step 6
**Blocks:** Step 8

---

### Step 8: Create `ResultTreeViewer` Component

**Objective:** Build the tree view component for JQ results that renders in the results panel, reusing the existing `JsonTreeNode` renderer.

**Context:**
- The existing `JsonTreeViewer` component renders the left-side tree. We need a similar component for results.
- The `JsonTreeNode` component is generic and can be reused, but it calls `getNodeValue` for the "copy value" action. We need it to call `getResultNodeValue` instead.

**Scope:**
- Create new file: `src/components/results/ResultTreeViewer.tsx`
- Modify: `src/components/json-tree/JsonTreeNode.tsx` (add a prop for the value-fetching function)

**Sub-tasks:**

1. **Modify `JsonTreeNode.tsx`** to accept an optional `getValueFn` prop:
   - Add to `JsonTreeNodeProps`: `getValueFn?: (path: string) => Promise<string>`
   - In the "Copy value" button's `onClick` handler (line 115), replace the direct `getNodeValue(node.data.data.id)` call with `(getValueFn ?? getNodeValue)(node.data.data.id)`.
   - This makes the component work for both the source tree (default `getNodeValue`) and the result tree (custom `getResultNodeValue`).

2. **Create `ResultTreeViewer.tsx`** with this structure:
   - Props:
     ```
     type ResultTreeViewerProps = {
       resultCount: number;
       resultTreeReady: boolean;
     };
     ```
   - Uses the `useResultTreeData` hook from Step 7.
   - Uses the same `useViewportSize` pattern as `JsonTreeViewer` (with a container ref and ResizeObserver). Extract `useViewportSize` to a shared location, or duplicate it (it's ~30 lines).
   - Renders a `<Tree<TreeNode>>` from `react-arborist` with identical configuration to `JsonTreeViewer`:
     - `rowHeight={28}`, `overscanCount={20}`, `indent={20}`
     - `disableDrag`, `disableDrop`, `openByDefault={false}`
     - `onToggle` → `loadChildren`
     - `onActivate` → `activateNode`
   - Custom node renderer wraps `JsonTreeNode` and passes `getValueFn={getResultNodeValue}` (imported from `tauri-commands.ts`).
   - Empty state: When `resultCount === 0` or `!resultTreeReady`, show nothing (the parent `ResultViewer` handles the empty state).
   - Loading state: While the initial root nodes are being fetched, show a spinner.

3. **Extract `useViewportSize`** from `JsonTreeViewer.tsx`:
   - Move the `useViewportSize` hook and `ViewportSize` type to a shared file: `src/hooks/useViewportSize.ts`.
   - Update `JsonTreeViewer.tsx` to import from the new location.
   - Use in `ResultTreeViewer.tsx` as well.

**Edge Cases & Gotchas:**
- **`getValueFn` default:** The `JsonTreeNode` must continue to work without the prop (for the left-side tree). Using `(getValueFn ?? getNodeValue)` with the existing import as fallback ensures backward compatibility.
- **Tree width/height:** The result tree lives inside a flex container in `ResultViewer`. The `useViewportSize` hook with ResizeObserver handles dynamic sizing correctly.
- **No data flicker:** When switching from List to Tree tab, the tree should not re-fetch root nodes if they're already loaded. The `useResultTreeData` hook's state persists across tab switches since the component stays mounted (React preserves state for components that remain in the tree, even if hidden via CSS). Use CSS `display: none` or conditional rendering with state preservation.

**Verification:**
- TypeScript compiles without errors.
- The left-side tree still works identically (no regression from `JsonTreeNode` change).
- The result tree renders with correct styling matching the left-side tree.

**Depends On:** Step 7
**Blocks:** Step 9

---

### Step 9: Integrate Tree Tab into `ResultViewer`

**Objective:** Add "Tree" as a third view mode tab in the `ResultViewer` component.

**Context:**
- `ResultViewer.tsx` currently has two view modes: "list" and "raw".
- We need to add "tree" as a third option.
- The Tree tab should be available whenever there are results.

**Scope:**
- Modify: `src/components/results/ResultViewer.tsx`

**Sub-tasks:**

1. Update the `ViewMode` type: `type ViewMode = "list" | "raw" | "tree";`

2. Add `resultTreeReady` to `ResultViewerProps`:
   ```
   type ResultViewerProps = {
     results: QueryResultItem[];
     isRunning: boolean;
     resultCount: number;
     elapsedMs: number | null;
     error: string | null;
     resultTreeReady: boolean;  // NEW
   };
   ```

3. Add a "Tree" tab button in the header bar (between "List" and "Raw", or after "Raw"):
   - Use the `TreePine` icon from `lucide-react` (or `Network`, `GitBranch`, or `Braces` — pick whichever best represents a tree view).
   - Follow the same pattern as the existing List and Raw buttons:
     ```
     <Button
       size="sm"
       variant={viewMode === "tree" ? "secondary" : "ghost"}
       onClick={() => setViewMode("tree")}
     >
       <TreePine className="size-3.5" />
       Tree
     </Button>
     ```

4. In the content area (lines 124-132), add the tree view case:
   - When `viewMode === "tree"`, render `<ResultTreeViewer resultCount={resultCount} resultTreeReady={resultTreeReady} />`.
   - The tree view should be rendered in the same flex container as List and Raw views.

5. Import `ResultTreeViewer` from `./ResultTreeViewer`.

**Edge Cases & Gotchas:**
- **Tab persistence:** When switching between tabs, the tree component should not lose its expanded state. Since React unmounts components that are conditionally rendered (`viewMode === "tree" ? <Tree /> : null`), the tree state would be lost. To preserve state, either:
  - (A) Render all three views but hide inactive ones with `display: none` (CSS). This keeps all components mounted.
  - (B) Accept that switching tabs resets the tree (simpler, and the tree re-fetches root nodes quickly).
  - **Recommended:** Option (A) for better UX. Wrap each view in a div with `className={cn("min-h-0 flex-1", viewMode !== "tree" && "hidden")}`.
- **Copy All button:** The existing "Copy All" button copies all results as text. This should continue to work regardless of which tab is active (it operates on the `results` array, not the view).

**Verification:**
- The three tabs (List, Raw, Tree) are visible and switch correctly.
- Switching tabs preserves tree expansion state (if using approach A).
- The "Copy All" button works from any tab.
- The empty state and error state still display correctly.

**Depends On:** Step 8
**Blocks:** Step 10

---

### Step 10: Wire Result Store Lifecycle into Query Execution

**Objective:** Connect the `resultTreeReady` flag from `useQueryExecution` to `ResultViewer`, completing the data flow.

**Context:**
- Step 6 added `resultTreeReady` to `useQueryExecution`.
- Step 9 added `resultTreeReady` to `ResultViewerProps`.
- We need to pass it through from `AppShell`.

**Scope:**
- Modify: `src/components/layout/AppShell.tsx`

**Sub-tasks:**

1. In `AppShell.tsx`, pass `resultTreeReady` to `ResultViewer`:
   ```
   <ResultViewer
     isRunning={queryExecution.isRunning}
     error={queryExecution.error}
     results={queryExecution.results}
     resultCount={queryExecution.resultCount}
     elapsedMs={queryExecution.elapsedMs}
     resultTreeReady={queryExecution.resultTreeReady}  // NEW
   />
   ```

2. Verify the complete data flow:
   - User runs query → `useQueryExecution` sets `resultTreeReady = false`, clears results
   - Backend executes query, stores parsed results in `ResultStore`, streams string results to frontend
   - Query completes → `useQueryExecution` sets `resultTreeReady = true`
   - `ResultViewer` passes `resultTreeReady` to `ResultTreeViewer`
   - `useResultTreeData` detects `resultTreeReady = true`, fetches root nodes from backend
   - Tree renders with expandable result nodes

**Edge Cases & Gotchas:**
- **File close:** When the user closes a file, `queryExecution.reset()` is called (line 43 of `AppShell.tsx`), which sets `resultTreeReady = false`. The result store in the backend should also be cleared. Add a call to clear the result store in the `close_file` Tauri command (in `commands/file.rs`), or add a separate frontend call. The simplest approach: clear `result_store` in the Rust `close_file` command alongside clearing `json_store`.
- **New query while tree is open:** When the user runs a new query, `resultTreeReady` flips to `false`, which causes `useResultTreeData` to reset its tree data. When the new query completes, `resultTreeReady` flips to `true` and the tree reloads. This is clean and correct.

**Verification:**
- End-to-end test: Open a JSON file, run a query that produces objects, switch to Tree tab, expand nodes, verify data matches.
- Run a query that produces primitives (strings, numbers) — tree shows them as leaf nodes.
- Run a query that produces 1000+ results — tree shows first page with "Load more..." node.
- Cancel a query mid-execution — tree tab shows nothing (resultTreeReady stays false).
- Close file — tree tab resets.
- Run `npm run build` — no TypeScript errors.
- Run `cargo build` in `src-tauri/` — no Rust errors.
- Run `cargo test` in `src-tauri/` — all tests pass.

**Depends On:** Step 6, Step 9
**Blocks:** None

---

## Appendix: File Change Summary

### New Files (5)
| File | Purpose |
|------|---------|
| `src-tauri/src/tree_nav.rs` | Shared tree navigation functions extracted from `json_store.rs` |
| `src-tauri/src/result_store.rs` | Parsed JQ result storage with tree navigation |
| `src-tauri/src/commands/result_tree.rs` | Tauri commands for result tree expansion |
| `src/components/results/ResultTreeViewer.tsx` | React component for result tree view |
| `src/components/results/useResultTreeData.ts` | React hook for result tree state management |

### Modified Files (10)
| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Add `mod tree_nav`, `mod result_store`, register new commands |
| `src-tauri/src/json_store.rs` | Delegate to `tree_nav` functions, re-export `TreeNodeInfo` |
| `src-tauri/src/state.rs` | Add `result_store: Mutex<ResultStore>` field |
| `src-tauri/src/commands/mod.rs` | Add `pub mod result_tree` |
| `src-tauri/src/commands/query.rs` | Store parsed results in `ResultStore`, clear on new query |
| `src-tauri/src/commands/tree.rs` | Move `ExpandResult` to `tree_nav.rs`, import from there |
| `src/services/tauri-commands.ts` | Add `expandResultNode`, `getResultNodeValue` wrappers |
| `src/components/query/useQueryExecution.ts` | Add `resultTreeReady` state |
| `src/components/results/ResultViewer.tsx` | Add "Tree" tab, render `ResultTreeViewer` |
| `src/components/layout/AppShell.tsx` | Pass `resultTreeReady` to `ResultViewer` |

### Extracted/Moved (1)
| File | Change |
|------|--------|
| `src/hooks/useViewportSize.ts` | Extracted from `JsonTreeViewer.tsx` for shared use |
| `src/components/json-tree/JsonTreeViewer.tsx` | Import `useViewportSize` from new location |
| `src/components/json-tree/JsonTreeNode.tsx` | Add optional `getValueFn` prop |

---

## Appendix: Parallelizing Execution

### Dependency Graph

| Step | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 2, 3 |
| 2 | 1 | 3, 4 |
| 3 | 2 | 5 |
| 4 | 2 | 10 |
| 5 | 3 | 7 |
| 6 | — | 7, 8 |
| 7 | 5, 6 | 8 |
| 8 | 7 | 9 |
| 9 | 8 | 10 |
| 10 | 6, 9 | — |

### Critical Path

The longest sequential chain that cannot be parallelized:

```
Step 1 → Step 2 → Step 3 → Step 5 → Step 7 → Step 8 → Step 9 → Step 10
```

Steps 4 and 6 are off the critical path and can overlap with steps on it.

### Execution Waves

```
WAVE 1 ─────────────────────────────────────────────
  Step 1: Extract tree navigation helpers (Rust)
  (no dependencies)

WAVE 2 ─────────────────────────────────────────────
  Step 2: Add ResultStore          │  Step 6: Update TypeScript types
  (depends on Step 1)              │  (no dependencies — can start
                                   │   immediately, even during Wave 1)

WAVE 3 ─────────────────────────────────────────────
  Step 3: Add Tauri commands       │  Step 4: Modify run_jq_query
  (depends on Step 2)              │  (depends on Step 2)

WAVE 4 ─────────────────────────────────────────────
  Step 5: Frontend command wrappers
  (depends on Step 3; Step 6 already done by now)
    ↓
  Step 7: useResultTreeData hook
  (depends on Step 5 + Step 6)

WAVE 5 ─────────────────────────────────────────────
  Step 8: ResultTreeViewer component
    ↓
  Step 9: Integrate Tree tab into ResultViewer
    ↓
  Step 10: Wire result store lifecycle
```

Note: Step 6 has no dependencies and is short (~TypeScript-only changes). It can be started concurrently with Step 1 or Step 2 without conflict.

### Team Allocation

**1 person:** Follow waves in order. Do Steps 3 and 4 back-to-back (both depend on Step 2, no inter-dependency). Do Step 6 whenever convenient — before Step 7 is the only hard constraint.

**2 people:**
- Person A (critical path): 1 → 2 → 3 → 5 → 7 → 8 → 9 → 10
- Person B (parallel work): 6 (any time) + 4 (after Step 2 done)

**3+ people:**
- Person A: 1 → 3 → 5 → 8 → 9
- Person B: 2 → 4
- Person C: 6 → 7 → 10

### Time Savings

| Execution style | Estimated total time |
|-----------------|---------------------|
| Fully sequential | ~250 min |
| Parallelized (2 people) | ~205 min |
| Parallelized (3+ people) | ~185 min |

Parallelizing Steps 4 and 6 onto separate tracks saves roughly 45–65 minutes depending on team size.
