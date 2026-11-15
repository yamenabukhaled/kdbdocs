import { readOfficeArchive } from "./office-archive";
self.onmessage = (
  event: MessageEvent<{ buffer: ArrayBuffer; kind: "word" | "slides" }>,
) => {
  try {
    self.postMessage({
      parts: readOfficeArchive(
        new Uint8Array(event.data.buffer),
        event.data.kind,
      ),
    });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Office package could not be expanded.",
    });
  }
};
