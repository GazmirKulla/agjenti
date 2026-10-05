export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 256 * 1024;
export async function readAudioForm(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    throw new Error("invalid_upload");
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES)
    throw new Error("audio_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_upload");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("audio_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const form = await new Response(bytes, {
    headers: { "Content-Type": request.headers.get("content-type")! },
  }).formData();
  const audio = form.get("audio");
  if (
    !(audio instanceof File) ||
    audio.size < 100 ||
    audio.size > MAX_AUDIO_BYTES
  )
    throw new Error("invalid_upload");
  const header = new Uint8Array(await audio.slice(0, 16).arrayBuffer());
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...header.slice(start, end));
  const mime = audio.type.split(";")[0];
  const ext =
    mime === "audio/webm" &&
    header[0] === 0x1a &&
    header[1] === 0x45 &&
    header[2] === 0xdf &&
    header[3] === 0xa3
      ? "webm"
      : ["audio/mp4", "audio/x-m4a"].includes(mime) && ascii(4, 8) === "ftyp"
        ? "mp4"
        : null;
  if (!ext) throw new Error("invalid_audio_type");
  const raw = form.get("answers");
  if (typeof raw !== "string" || raw.length > 64000)
    throw new Error("invalid_answers");
  let answers: unknown;
  try {
    answers = JSON.parse(raw);
  } catch {
    throw new Error("invalid_answers");
  }
  return {
    file: new File([audio], `business.${ext}`, { type: mime }),
    raw: answers,
  };
}
