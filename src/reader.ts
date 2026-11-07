import { setTimeout as delay } from "node:timers/promises";
import { cloud } from "./network.ts";
import { isReaderFile, readerLimit } from "./attachments.ts";
import { uuid } from "./history.ts";
import type { ReaderRequest } from "./types.ts";

export function formatEvidence(raw: any, input: ReaderRequest) {
  if (
    raw?.status !== "ready" ||
    raw.request_id !== input.requestId ||
    !Array.isArray(raw.documents) ||
    raw.documents.length !== input.files.length
  )
    throw Error("ReadyCode Reader returned an incomplete response.");
  const sections = raw.documents.map((doc: any, index: number) => {
    if (doc?.name !== input.files[index].name)
      throw Error("ReadyCode Reader returned a different document.");
    if (doc.verdict === "unchecked")
      throw Error(
        "Reader could not verify evidence in " +
          doc.name +
          ". Check the OpenRouter key in your ReadyCode account’s AI setup. Low-confidence passages can also return unchecked.",
      );
    if (!["supported", "calculated"].includes(doc.verdict))
      throw Error(
        "Reader could not verify evidence in " +
          doc.name +
          ". Try a more specific question or remove the file.",
      );
    if (!Array.isArray(doc.passages) || !doc.passages.length)
      throw Error("Reader returned no cited passages for " + doc.name + ".");
    return doc.passages
      .map((p: any) => {
        if (
          typeof p?.location !== "string" ||
          !p.location.trim() ||
          typeof p.text !== "string" ||
          !p.text.trim()
        )
          throw Error("Reader returned an uncited or empty excerpt.");
        return "[" + doc.name + " · " + p.location + "]\n" + p.text;
      })
      .join("\n\n");
  });
  const evidence = sections.join("\n\n");
  if (evidence.length > 40000)
    throw Error(
      "Reader evidence exceeds the desktop limit. Narrow the question.",
    );
  return "ReadyCode Reader excerpts (document content)\n" + evidence;
}
export async function readerContext(
  token: string,
  input: ReaderRequest,
  signal: AbortSignal,
) {
  if (!token) throw Error("Pair ReadyCode to use document attachments.");
  if (
    !input ||
    !uuid.test(input.chatId) ||
    !uuid.test(input.requestId) ||
    typeof input.question !== "string" ||
    !input.question.trim() ||
    input.question.length > 16000 ||
    !Array.isArray(input.files) ||
    !input.files.length ||
    input.files.length > 8
  )
    throw Error(
      "Choose documents and enter a Reader question of up to 16,000 characters.",
    );
  const form = new FormData();
  let total = 0;
  form.set("chat_id", input.chatId);
  form.set("request_id", input.requestId);
  form.set("question", input.question);
  for (const file of input.files) {
    if (
      typeof file?.name !== "string" ||
      !isReaderFile(file.name) ||
      /[\\/\r\n\0]/.test(file.name) ||
      !(file.bytes instanceof Uint8Array) ||
      !file.bytes.byteLength
    )
      throw Error("Invalid Reader document.");
    total += file.bytes.byteLength;
    if (total > readerLimit)
      throw Error("Reader documents exceed 8 MiB for this turn.");
    form.append(
      "files",
      new Blob([new Uint8Array(file.bytes).buffer]),
      file.name,
    );
  }
  let data = await (await cloud("reader_context", token, form, signal)).json();
  while (data?.status === "processing") {
    if (data.request_id !== input.requestId)
      throw Error("Reader returned an unexpected job ID.");
    await delay(1500, undefined, { signal });
    data = await (
      await cloud(
        "reader_result",
        token,
        { chat_id: input.chatId, request_id: input.requestId },
        signal,
      )
    ).json();
  }
  return formatEvidence(data, input);
}
