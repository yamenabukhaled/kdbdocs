export function relativePath(value: string): string {
  if (!value || value.length > 1000 || /[\\:\x00-\x1f\x7f]/.test(value))
    throw new Error("Invalid relative folder path.");
  const parts = value.split("/");
  if (
    parts.length > 32 ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid or excessively deep relative folder path.");
  return value;
}
