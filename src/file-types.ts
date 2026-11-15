export const CODE_EXTENSIONS = [
  "r",
  "rmd",
  "qmd",
  "py",
  "pyw",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "java",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "cs",
  "go",
  "rs",
  "rb",
  "php",
  "swift",
  "kt",
  "kts",
  "scala",
  "sql",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "psm1",
  "bat",
  "cmd",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "vue",
  "svelte",
] as const;
export const TEXT_EXTENSIONS = [
  "txt",
  "md",
  "markdown",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "xml",
  "csv",
  "tsv",
  "tex",
  "log",
] as const;
export const FILE_ACCEPT = [
  ...new Set(["pdf", "docx", "pptx", ...CODE_EXTENSIONS, ...TEXT_EXTENSIONS]),
]
  .map((ext) => `.${ext}`)
  .join(",");
export const extension = (name: string) =>
  name.split(".").pop()?.toLowerCase() ?? "";
export function fileKind(
  name: string,
): "pdf" | "word" | "slides" | "code" | "text" | "unsupported" {
  const ext = extension(name);
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "word";
  if (ext === "pptx") return "slides";
  if ((CODE_EXTENSIONS as readonly string[]).includes(ext)) return "code";
  if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) return "text";
  return "unsupported";
}
export function matchesFileType(name: string, filter: string): boolean {
  if (filter === "python") return ["py", "pyw"].includes(extension(name));
  if (filter === "javascript")
    return ["js", "jsx", "mjs", "cjs"].includes(extension(name));
  if (filter === "typescript") return ["ts", "tsx"].includes(extension(name));
  return (
    filter === "all" ||
    (filter === "code"
      ? fileKind(name) === "code"
      : filter === "data"
        ? fileKind(name) === "text"
        : extension(name) === filter)
  );
}
