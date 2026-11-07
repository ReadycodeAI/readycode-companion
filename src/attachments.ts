export const fileTypes = ".txt,.md,.csv,.tsv,.json,.log,.pdf,.docx,.xlsx";
export const readerLimit = 8 * 1024 * 1024;
export const isReaderFile = (name: string) => /\.(pdf|docx|xlsx)$/i.test(name);
export type Attachment = { name: string; text: string };
export async function readAttachments(
  files: File[],
  current: Attachment[],
): Promise<Attachment[]> {
  if (files.length + current.length > 8)
    throw Error("Attach at most eight text files per message.");
  if (files.reduce((sum, f) => sum + f.size, 0) > 240000)
    throw Error("The files exceed the message size limit.");
  const result = [...current];
  for (const f of files) {
    if (!/\.(txt|md|csv|tsv|json|log)$/i.test(f.name))
      throw Error("Choose a UTF-8 text, Markdown, CSV, TSV, JSON or log file.");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await f.arrayBuffer(),
      );
    } catch {
      throw Error(f.name + " could not be read as UTF-8 text.");
    }
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text) || !text.trim())
      throw Error(f.name + " contains binary data or is empty.");
    result.push({
      name: f.name
        .split(/[\\/]/)
        .pop()!
        .replace(/[\r\n]/g, " "),
      text,
    });
  }
  attachmentPrompt("", result);
  return result;
}
export function attachmentPrompt(draft: string, files: Attachment[]) {
  const prompt = [
    draft.trim(),
    ...files.map((f) => "Attached file: " + f.name + "\n" + f.text),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (prompt.length > 60000)
    throw Error(
      "The message and attached text exceed 60,000 characters. Remove a file or shorten the message.",
    );
  return prompt;
}
