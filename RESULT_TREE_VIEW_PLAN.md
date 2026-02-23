# Results Panel Tree Viewer Plan

## Goal
Add a `Tree` mode to the right-side results/preview area so jq results can be explored as expandable object/array trees, visually aligned with the left workspace tree experience.

## Scope
- Add a new `Tree` tab in the results viewer (`List`, `Tree`, `Raw`).
- Render each jq result as either:
  - primitive row (string/number/boolean/null), or
  - expandable tree (object/array).
- Reuse existing tree rendering styles/components where possible.
- Support lazy expansion and pagination for large result structures.

## Architecture Decision
Use a backend cache for result JSON values instead of sending full JSON on every expand.

- Reason: avoids repeated large IPC payloads for deep expansions.
- Flow:
  1. Frontend caches a result JSON once and gets `cacheId`.
  2. Frontend requests expanded children by `cacheId + path + pagination`.

## Implementation Plan

### 1) Rust: Add result-cache support in app state
File: `src-tauri/src/state.rs`

- Add `result_cache` storage in `AppState` (e.g., `HashMap<String, serde_json::Value>` behind `Mutex`).
- Use UUID keys for cache entries.

### 2) Rust: Reuse child-expansion logic from any root value
File: `src-tauri/src/json_store.rs`

- Extract reusable helper:
  - `get_children_from_value(root: &Value, path: &str, offset: usize, limit: usize)`
- Keep existing file-tree behavior intact by reusing this helper in current node expansion paths.

### 3) Rust: Add commands for result-tree expansion
File: `src-tauri/src/commands/tree.rs`

- Add `cache_result_json(json: String) -> Result<String, String>`
  - Parse JSON, store in cache, return `cacheId`.
- Add `expand_result_node(cache_id: String, path: String, offset: Option<usize>, limit: Option<usize>) -> Result<ExpandResult, String>`
  - Look up cached JSON by ID and return children for the requested path.

### 4) Rust: Register commands
File: `src-tauri/src/lib.rs`

- Register both new commands in `invoke_handler`.

### 5) Frontend: Add command wrappers
File: `src/services/tauri-commands.ts`

- Add:
  - `cacheResultJson(json: string): Promise<string>`
  - `expandResultNode(cacheId: string, path: string, offset?: number, limit?: number): Promise<ExpandResult>`

### 6) Frontend: Build result-tree data hook
File: `src/components/results/useResultTreeData.ts` (new)

- Responsibilities:
  - Cache result JSON once and retain `cacheId`.
  - Build root-level nodes from `JSON.parse(result.value)`.
  - Lazy-load child nodes via `expandResultNode`.
  - Track node loading states.
  - Handle pagination (`hasMore`, synthetic load-more node).

### 7) Frontend: Add results tree renderer
File: `src/components/results/ResultTreeView.tsx` (new)

- Render each result item with index/type header.
- Primitive results: keep current flat display style.
- Object/array results: render expandable tree using existing tree node UI patterns.
- Keep layout performant and readable for mixed result types.

### 8) Frontend: Integrate tree mode toggle
File: `src/components/results/ResultViewer.tsx`

- Extend `ViewMode` with `"tree"`.
- Add `Tree` toggle button in header.
- Render `ResultTreeView` when tree mode is active.

## Files Expected to Change

Modified:
- `src-tauri/src/state.rs`
- `src-tauri/src/json_store.rs`
- `src-tauri/src/commands/tree.rs`
- `src-tauri/src/lib.rs`
- `src/services/tauri-commands.ts`
- `src/components/results/ResultViewer.tsx`

New:
- `src/components/results/useResultTreeData.ts`
- `src/components/results/ResultTreeView.tsx`

## Validation Checklist
- `Tree` tab appears and toggles correctly.
- Primitive-only results still render correctly.
- Object/array results expand/collapse correctly.
- Deep node expansion works using cached result IDs.
- Pagination works for large arrays/objects.
- Existing left-side workspace tree remains unaffected.

## Risks and Mitigations
- Cache growth over time: add cleanup strategy later (TTL or clear on new query/session).
- Invalid JSON result values: guard parse failures and show readable fallback/error row.
- Very large result nodes: rely on lazy loading + pagination; avoid eager full-tree materialization.

## Out of Scope (for this pass)
- Advanced cache eviction policy.
- Cross-session persistence of cached results.
- Full-text search inside result trees.
