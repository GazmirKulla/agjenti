import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import { conversationFileKind } from "./instagram-export";

/** Limits for an uploaded export. Media in the archive is skipped without being
 * decompressed; only conversation files are read, and only up to these sizes. */
export const ARCHIVE_LIMITS = {
  /** Entries listed in the archive, media included. */
  entries: 60_000,
  /** One conversation file, decompressed. */
  fileBytes: 25 * 1024 * 1024,
  /** All conversation files read in one step, decompressed. */
  stepBytes: 40 * 1024 * 1024,
  /** Decompressed / compressed: beyond this a file is treated as a zip bomb. */
  ratio: 120,
  /** Conversation files in one archive. */
  conversationFiles: 20_000,
};

export class ArchiveError extends Error {
  constructor(public code: "not_zip" | "too_many_entries" | "unsafe_path" | "too_many_conversations" | "corrupt") { super(code); }
}

export const isZip = (head: Uint8Array) => head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05) && (head[3] === 0x04 || head[3] === 0x06);

/** A name inside the archive is used only as a label, never as a path on disk;
 * absolute names, parent references and drive letters still make the archive suspect. */
export function safeEntryName(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  return !!n && n.length <= 1000 && !n.startsWith("/") && !/^[a-z]:/i.test(n) && !n.split("/").includes("..") && !n.includes("\0");
}

export type ArchiveRead = {
  /** Conversation files in archive order, with their index among conversation files. */
  files: { index: number; path: string; text: string }[];
  /** Every conversation file of the archive (to plan the next steps). */
  total: number;
  /** Files skipped because they were too large or looked unsafe. */
  skipped: { path: string; reason: "too_large" | "ratio" | "not_text" }[];
  /** The step stopped reading because of `stepBytes`: continue from `nextIndex`. */
  nextIndex: number | null;
};

/** Reads the conversation files with index >= `from` from a ZIP stream, until
 * `stepBytes` decompressed bytes were read. Entries are never written to disk. */
export async function readArchive(stream: ReadableStream<Uint8Array>, from = 0, limits = ARCHIVE_LIMITS): Promise<ArchiveRead> {
  const result: ArchiveRead = { files: [], total: 0, skipped: [], nextIndex: null };
  let entries = 0;
  let stepBytes = 0;
  let failure: Error | null = null;
  const pending: Promise<void>[] = [];
  const unzip = new Unzip((file: UnzipFile) => {
    if (failure) return;
    entries++;
    if (entries > limits.entries) { failure = new ArchiveError("too_many_entries"); return; }
    if (!safeEntryName(file.name)) { failure = new ArchiveError("unsafe_path"); return; }
    if (!conversationFileKind(file.name)) return; // media and other data: not decompressed
    const index = result.total++;
    if (result.total > limits.conversationFiles) { failure = new ArchiveError("too_many_conversations"); return; }
    if (index < from || result.nextIndex !== null) return;
    const declared = file.originalSize ?? 0;
    if (declared > limits.fileBytes) { result.skipped.push({ path: file.name, reason: "too_large" }); return; }
    if (stepBytes + Math.max(declared, file.size ?? 0) > limits.stepBytes && result.files.length) { result.nextIndex = index; return; }
    const chunks: Uint8Array[] = [];
    let size = 0;
    pending.push(new Promise<void>((resolve) => {
      file.ondata = (error, chunk, final) => {
        if (error) { result.skipped.push({ path: file.name, reason: "not_text" }); resolve(); return; }
        size += chunk.length;
        const compressed = Math.max(1, file.size ?? 1);
        if (size > limits.fileBytes || (size > 1024 * 1024 && size / compressed > limits.ratio)) {
          file.terminate();
          result.skipped.push({ path: file.name, reason: size > limits.fileBytes ? "too_large" : "ratio" });
          resolve();
          return;
        }
        chunks.push(chunk);
        if (!final) return;
        stepBytes += size;
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
        try { result.files.push({ index, path: file.name, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }); }
        catch { result.skipped.push({ path: file.name, reason: "not_text" }); }
        resolve();
      };
      file.start();
    }));
  });
  unzip.register(UnzipInflate);
  const reader = stream.getReader();
  let first = true;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (first && value.length) { if (!isZip(value)) throw new ArchiveError("not_zip"); first = false; }
      unzip.push(value, false);
      if (failure) throw failure;
    }
    unzip.push(new Uint8Array(0), true);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error instanceof ArchiveError ? error : new ArchiveError("corrupt");
  }
  if (failure) throw failure;
  await Promise.all(pending);
  result.files.sort((a, b) => a.index - b.index);
  return result;
}
