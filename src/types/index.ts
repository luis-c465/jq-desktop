export type TreeNodeInfo = {
  id: string;
  key: string;
  valueType: string;
  preview: string;
  childCount: number | null;
  hasChildren: boolean;
};

export type LoadProgress =
  | {
      type: "Reading";
      bytesRead: number;
      totalBytes: number;
    }
  | {
      type: "Parsing";
    }
  | {
      type: "Complete";
      rootNodes: TreeNodeInfo[];
      fileName: string;
      fileSize: number;
    }
  | {
      type: "Error";
      message: string;
    };

export type QueryResult =
  | {
      type: "Compiling";
    }
  | {
      type: "Running";
    }
  | {
      type: "Result";
      index: number;
      value: string;
      valueType: string;
    }
  | {
      type: "Complete";
      totalResults: number;
      elapsedMs: number;
    }
  | {
      type: "Error";
      message: string;
    };

export type ExpandResult = {
  children: TreeNodeInfo[];
  totalChildren: number;
  offset: number;
  hasMore: boolean;
};

export type FileInfo = {
  fileName: string;
  filePath: string;
  fileSize: number;
  loaded: boolean;
};
