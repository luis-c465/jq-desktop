import { Channel, invoke } from "@tauri-apps/api/core";

import type { ExpandResult, LoadProgress, QueryResult } from "~/types";

export async function loadFile(
  path: string,
  onProgress: (progress: LoadProgress) => void,
): Promise<void> {
  const channel = new Channel<LoadProgress>();
  channel.onmessage = onProgress;

  await invoke("load_file", {
    path,
    onProgress: channel,
  });
}

export async function expandNode(
  path: string,
  offset?: number,
  limit?: number,
): Promise<ExpandResult> {
  return invoke<ExpandResult>("expand_node", { path, offset, limit });
}

export async function getNodeValue(path: string): Promise<string> {
  return invoke<string>("get_node_value", { path });
}

export async function expandResultNode(
  path: string,
  offset?: number,
  limit?: number,
): Promise<ExpandResult> {
  return invoke<ExpandResult>("expand_result_node", { path, offset, limit });
}

export async function getResultNodeValue(path: string): Promise<string> {
  return invoke<string>("get_result_node_value", { path });
}

export async function runJqQuery(
  query: string,
  onResult: (result: QueryResult) => void,
): Promise<void> {
  const channel = new Channel<QueryResult>();
  channel.onmessage = onResult;

  await invoke("run_jq_query", {
    query,
    onResult: channel,
  });
}

export async function validateJqQuery(query: string): Promise<boolean> {
  return invoke<boolean>("validate_jq_query", { query });
}

export async function cancelQuery(): Promise<void> {
  await invoke("cancel_query");
}

export async function closeFile(): Promise<void> {
  await invoke("close_file");
}

export async function getFileSize(path: string): Promise<number> {
  return invoke<number>("get_file_size", { path });
}
