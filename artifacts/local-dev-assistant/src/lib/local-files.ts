export type AttachmentKind = "text" | "image" | "binary";

export interface LocalAttachment {
  id: string;
  path: string;
  name: string;
  size: number;
  mimeType: string;
  kind: AttachmentKind;
  text?: string;
  note?: string;
  file: File;
}

export interface LocalDirectoryHandle {
  name: string;
  kind: "directory";
  entries(): AsyncIterableIterator<
    [string, LocalFileHandle | LocalDirectoryHandle]
  >;
  getFileHandle(name: string): Promise<LocalFileHandle>;
  getDirectoryHandle(name: string): Promise<LocalDirectoryHandle>;
}

export interface LocalFileHandle {
  name: string;
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options: {
      mode: "read" | "readwrite";
    }) => Promise<LocalDirectoryHandle>;
  }
}

const MAX_TEXT_FILE_BYTES = 1_500_000;
const MAX_TOTAL_TEXT_BYTES = 8_000_000;
const MAX_DIRECTORY_FILES = 2_000;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
]);

const TEXT_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "csv",
  "dart",
  "go",
  "h",
  "hpp",
  "html",
  "graphql",
  "gql",
  "gradle",
  "hs",
  "ipynb",
  "ini",
  "java",
  "js",
  "jsx",
  "json",
  "kt",
  "kts",
  "less",
  "lua",
  "md",
  "mdx",
  "mjs",
  "mts",
  "php",
  "pl",
  "proto",
  "py",
  "r",
  "rb",
  "rs",
  "sass",
  "scala",
  "scss",
  "sh",
  "sql",
  "svg",
  "swift",
  "svelte",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
  "lock",
  "gitignore",
  "dockerignore",
  "editorconfig",
  "env.example",
  "properties",
]);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

function extensionOf(name: string): string {
  const basename = name.split(/[\\/]/).pop() ?? name;
  const lastDot = basename.lastIndexOf(".");
  return (lastDot > 0 ? basename.slice(lastDot + 1) : basename).toLowerCase();
}

function isTextFile(file: File): boolean {
  if (TEXT_EXTENSIONS.has(extensionOf(file.name))) return true;
  return (
    file.type.startsWith("text/") ||
    /(?:json|javascript|typescript|xml|yaml|toml|sql)/i.test(file.type)
  );
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(extensionOf(file.name));
}

function relativePath(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath || file.name;
}

function makeId(file: File, index: number): string {
  return `${relativePath(file)}-${file.size}-${file.lastModified}-${index}`;
}

export async function describeLocalFiles(
  files: FileList | File[],
): Promise<LocalAttachment[]> {
  const input = Array.from(files);
  let totalTextBytes = 0;

  return Promise.all(
    input.map(async (file, index): Promise<LocalAttachment> => {
      const base = {
        id: makeId(file, index),
        path: relativePath(file),
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        file,
      };

      if (isTextFile(file)) {
        if (file.size > MAX_TEXT_FILE_BYTES) {
          return {
            ...base,
            kind: "text",
            note: "Too large to include in a prompt (1.5 MB limit per file).",
          };
        }
        totalTextBytes += file.size;
        if (totalTextBytes > MAX_TOTAL_TEXT_BYTES) {
          return {
            ...base,
            kind: "text",
            note: "Not included in prompts (8 MB workspace text limit).",
          };
        }
        try {
          return { ...base, kind: "text", text: await file.text() };
        } catch {
          return { ...base, kind: "binary", note: "This file could not be read." };
        }
      }

      if (isImageFile(file)) {
        return {
          ...base,
          kind: "image",
          note: file.size > 12_000_000 ? "Large image; metadata only." : undefined,
        };
      }

      return {
        ...base,
        kind: "binary",
        note: "Attached. This format is not decoded; only its name, type, and size are sent to the local model.",
      };
    }),
  );
}

export async function readDirectoryFiles(
  root: LocalDirectoryHandle,
): Promise<{
  files: File[];
  skippedDirectories: string[];
  limitReached: boolean;
}> {
  const files: File[] = [];
  const skippedDirectories: string[] = [];

  async function visit(directory: LocalDirectoryHandle, prefix: string) {
    for await (const [name, handle] of directory.entries()) {
      if (files.length >= MAX_DIRECTORY_FILES) return;
      if (handle.kind === "directory") {
        if (IGNORED_DIRECTORIES.has(name)) {
          skippedDirectories.push(`${prefix}${name}`);
          continue;
        }
        await visit(handle, `${prefix}${name}/`);
      } else {
        const sourceFile = await handle.getFile();
        const localFile = new File([sourceFile], name, {
          type: sourceFile.type,
          lastModified: sourceFile.lastModified,
        });
        Object.defineProperty(localFile, "webkitRelativePath", {
          value: `${prefix}${name}`,
        });
        files.push(localFile);
        if (files.length >= MAX_DIRECTORY_FILES) return;
      }
    }
  }

  await visit(root, "");
  return {
    files,
    skippedDirectories,
    limitReached: files.length >= MAX_DIRECTORY_FILES,
  };
}

export async function imageAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export async function writePatchedTextFile(
  root: LocalDirectoryHandle,
  path: string,
  expectedOriginal: string,
  content: string,
): Promise<void> {
  const segments = path.split(/[\\/]/).filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((part) => part === "." || part === "..")
  ) {
    throw new Error("The proposed file path is not safe to write.");
  }

  let currentDirectory = root;
  for (const segment of segments.slice(0, -1)) {
    currentDirectory = await currentDirectory.getDirectoryHandle(segment);
  }
  const fileHandle = await currentDirectory.getFileHandle(
    segments[segments.length - 1],
  );
  const currentFile = await fileHandle.getFile();
  const currentContent = await currentFile.text();
  if (currentContent !== expectedOriginal) {
    throw new Error(
      `${path} has changed since it was attached. Reattach the file before applying this proposal.`,
    );
  }
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export function buildAttachmentContext(
  attachments: LocalAttachment[],
): string {
  if (attachments.length === 0) return "No local files are attached.";
  return attachments
    .map((attachment) =>
      JSON.stringify({
        path: attachment.path,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
        content: attachment.text,
        note: attachment.note,
      }),
    )
    .join("\n");
}