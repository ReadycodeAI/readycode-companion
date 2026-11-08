export type DocumentMeasurement = {
  method: "exact";
  tokenizer: string;
  full_text_tokens: number;
  excerpt_tokens: number;
};
export type DocumentReceipt = {
  request_id: string;
  documents: { name: string; locations: string[]; measurement?: DocumentMeasurement }[];
};

export function measurement(raw: any): DocumentMeasurement | undefined {
  if (raw?.method !== "exact" || typeof raw.tokenizer !== "string" ||
      !raw.tokenizer.trim() || raw.tokenizer.length > 160 ||
      ![raw.full_text_tokens, raw.excerpt_tokens].every(
        n => Number.isSafeInteger(n) && n > 0)) return;
  return { method: "exact", tokenizer: raw.tokenizer,
    full_text_tokens: raw.full_text_tokens, excerpt_tokens: raw.excerpt_tokens };
}

export function readDocumentReceipt(raw: any): DocumentReceipt | undefined {
  if (typeof raw?.request_id !== "string" || !raw.request_id ||
      !Array.isArray(raw.documents) || !raw.documents.length || raw.documents.length > 8) return;
  const documents: DocumentReceipt["documents"] = [];
  for (const doc of raw.documents) {
    if (typeof doc?.name !== "string" || !doc.name || !Array.isArray(doc.locations) ||
        !doc.locations.length || !doc.locations.every((s: unknown) => typeof s === "string" && s.trim())) return;
    documents.push({name: doc.name, locations: [...new Set<string>(doc.locations)],
      measurement: measurement(doc.measurement)});
  }
  return { request_id: raw.request_id, documents };
}
