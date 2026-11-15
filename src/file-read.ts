export async function readFileBytes(
  file: File,
  timeoutMs = 30_000,
): Promise<ArrayBuffer> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      file.arrayBuffer(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Reading this local file timed out. Make sure it is available offline (especially in OneDrive), then reselect it. No cloud fallback was attempted.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
