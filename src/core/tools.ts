import Anthropic from "@anthropic-ai/sdk";

// ─── Judge Tool ───

export const summonJudgeTool: Anthropic.Tool = {
  name: "summon_judge",
  description:
    "Call this tool when you and the other party have reached a consensus. " +
    "Provide the agreed-upon final answer that the judge should use to produce the output.",
  input_schema: {
    type: "object" as const,
    properties: {
      consensus_answer: {
        type: "string",
        description: "The final agreed-upon answer after debate.",
      },
      key_improvements: {
        type: "string",
        description: "Summary of key improvements made during the debate.",
      },
    },
    required: ["consensus_answer", "key_improvements"],
  },
};

// ─── File Tools ───

const readFileTool: Anthropic.Tool = {
  name: "read_file",
  description: "Read the contents of a file.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Relative file path." },
    },
    required: ["path"],
  },
};

const writeFileTool: Anthropic.Tool = {
  name: "write_file",
  description: "Create or overwrite a file with the provided content.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Relative file path." },
      content: { type: "string", description: "File content to write." },
    },
    required: ["path", "content"],
  },
};

const editFileTool: Anthropic.Tool = {
  name: "edit_file",
  description: "Replace a specific string in a file with new content.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Relative file path." },
      old_str: { type: "string", description: "Exact string to find." },
      new_str: { type: "string", description: "Replacement string." },
    },
    required: ["path", "old_str", "new_str"],
  },
};

const deleteFileTool: Anthropic.Tool = {
  name: "delete_file",
  description: "Delete a file or directory.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Relative path to delete." },
    },
    required: ["path"],
  },
};

const moveFileTool: Anthropic.Tool = {
  name: "move_file",
  description: "Move or rename a file/directory.",
  input_schema: {
    type: "object" as const,
    properties: {
      source: { type: "string", description: "Source path." },
      destination: { type: "string", description: "Destination path." },
    },
    required: ["source", "destination"],
  },
};

const copyFileTool: Anthropic.Tool = {
  name: "copy_file",
  description: "Copy a file or directory.",
  input_schema: {
    type: "object" as const,
    properties: {
      source: { type: "string", description: "Source path." },
      destination: { type: "string", description: "Destination path." },
    },
    required: ["source", "destination"],
  },
};

// ─── Directory Tools ───

const listFilesTool: Anthropic.Tool = {
  name: "list_files",
  description: "List files and directories at a path.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Directory path. Use '.' for current." },
    },
    required: ["path"],
  },
};

const directoryTreeTool: Anthropic.Tool = {
  name: "directory_tree",
  description: "Show a tree view of the directory structure.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Root directory. Default '.'." },
      max_depth: { type: "number", description: "Max depth. Default 3." },
    },
    required: [],
  },
};

const fileInfoTool: Anthropic.Tool = {
  name: "file_info",
  description: "Get metadata about a file (size, lines, modified date).",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "File path." },
    },
    required: ["path"],
  },
};

// ─── Search Tools ───

const grepSearchTool: Anthropic.Tool = {
  name: "grep_search",
  description: "Search for a text pattern across files in a directory.",
  input_schema: {
    type: "object" as const,
    properties: {
      pattern: { type: "string", description: "Text pattern to search for." },
      path: { type: "string", description: "Directory to search in. Default '.'." },
      include: { type: "string", description: "File glob pattern, e.g. '*.ts'." },
    },
    required: ["pattern"],
  },
};

// ─── Shell Tool ───

const runShellTool: Anthropic.Tool = {
  name: "run_shell",
  description:
    "Execute a shell command in the working directory. " +
    "Use for builds, tests, git, package managers, etc.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "Shell command to execute." },
      timeout: { type: "number", description: "Timeout in ms. Default 30000." },
    },
    required: ["command"],
  },
};

// ─── Web Tools ───

const webFetchTool: Anthropic.Tool = {
  name: "web_fetch",
  description: "Fetch content from a URL (HTTPS only).",
  input_schema: {
    type: "object" as const,
    properties: {
      url: { type: "string", description: "HTTPS URL to fetch." },
    },
    required: ["url"],
  },
};

const webSearchTool: Anthropic.Tool = {
  name: "web_search",
  description: "Search the web for information using DuckDuckGo.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Search query." },
    },
    required: ["query"],
  },
};

// ─── Exports ───

export const allTools: Anthropic.Tool[] = [
  // Files
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  moveFileTool,
  copyFileTool,
  // Directories
  listFilesTool,
  directoryTreeTool,
  fileInfoTool,
  // Search
  grepSearchTool,
  // Shell
  runShellTool,
  // Web
  webFetchTool,
  webSearchTool,
  // Judge
  summonJudgeTool,
];
