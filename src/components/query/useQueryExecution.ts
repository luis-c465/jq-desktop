import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import * as tauriCommands from "~/services/tauri-commands";
import type { LspDiagnostic } from "~/services/tauri-commands";
import type { QueryResult } from "~/types";

export type QueryResultItem = {
  index: number;
  value: string;
  valueType: string;
};

export type UseQueryExecutionReturn = {
  query: string;
  isValid: boolean | null;
  validationError: string | null;
  isRunning: boolean;
  results: QueryResultItem[];
  resultCount: number;
  resultTreeReady: boolean;
  elapsedMs: number | null;
  error: string | null;
  setQuery: (query: string) => void;
  setDiagnostics: (diagnostics: LspDiagnostic[]) => void;
  executeQuery: () => Promise<void>;
  cancelExecution: () => Promise<void>;
  reset: () => void;
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function handleQueryResult(
  message: QueryResult,
  setIsRunning: (value: boolean) => void,
  setResults: Dispatch<SetStateAction<QueryResultItem[]>>,
  setResultCount: (value: number) => void,
  setResultTreeReady: (value: boolean) => void,
  setElapsedMs: (value: number | null) => void,
  setError: (value: string | null) => void,
) {
  switch (message.type) {
    case "Compiling":
    case "Running": {
      setIsRunning(true);
      break;
    }
    case "Result": {
      setResults((current: QueryResultItem[]) => [...current, message]);
      setResultCount(message.index + 1);
      break;
    }
    case "Complete": {
      setIsRunning(false);
      setResultCount(message.totalResults);
      setResultTreeReady(true);
      setElapsedMs(message.elapsedMs);
      break;
    }
    case "Error": {
      setIsRunning(false);
      setError(message.message);
      break;
    }
    default: {
      break;
    }
  }
}

export function useQueryExecution(hasFileLoaded: boolean): UseQueryExecutionReturn {
  const [query, setQueryState] = useState("");
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<QueryResultItem[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [resultTreeReady, setResultTreeReady] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setQuery = useCallback((nextQuery: string) => {
    setQueryState(nextQuery);
    setError(null);
  }, []);

  const setDiagnostics = useCallback(
    (diagnostics: LspDiagnostic[]) => {
      if (!query.trim()) {
        setIsValid(null);
        setValidationError(null);
        return;
      }

      if (diagnostics.length === 0) {
        setIsValid(true);
        setValidationError(null);
        return;
      }

      setIsValid(false);
      setValidationError(diagnostics[0]?.message ?? "jq syntax error");
    },
    [query],
  );

  const executeQuery = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || !hasFileLoaded) {
      return;
    }

    if (isRunning) {
      await tauriCommands.cancelQuery();
    }

    setResults([]);
    setResultCount(0);
    setResultTreeReady(false);
    setElapsedMs(null);
    setError(null);
    setIsRunning(true);

    try {
      await tauriCommands.runJqQuery(trimmed, (message) => {
        handleQueryResult(
          message,
          setIsRunning,
          setResults,
          setResultCount,
          setResultTreeReady,
          setElapsedMs,
          setError,
        );
      });
    } catch (runError) {
      setIsRunning(false);
      setError(getErrorMessage(runError, "Failed to execute query"));
    }
  }, [hasFileLoaded, isRunning, query]);

  const cancelExecution = useCallback(async () => {
    try {
      await tauriCommands.cancelQuery();
      setIsRunning(false);
    } catch (cancelError) {
      setError(getErrorMessage(cancelError, "Failed to cancel query"));
    }
  }, []);

  const reset = useCallback(() => {
    setQueryState("");
    setIsValid(null);
    setValidationError(null);
    setIsRunning(false);
    setResults([]);
    setResultCount(0);
    setResultTreeReady(false);
    setElapsedMs(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!hasFileLoaded) {
      reset();
    }
  }, [hasFileLoaded, reset]);

  return {
    query,
    isValid,
    validationError,
    isRunning,
    results,
    resultCount,
    resultTreeReady,
    elapsedMs,
    error,
    setQuery,
    setDiagnostics,
    executeQuery,
    cancelExecution,
    reset,
  };
}
