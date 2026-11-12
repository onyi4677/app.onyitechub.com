export type WorkbookSheet = { name: string; rows: string[][] };
export type ScreeningWorkbook = {
  screening: Record<string, string>[];
  evidence: Record<string, string>[];
  verification: Record<string, string>[];
  sheetCounts: { screening: number; evidence: number; verification: number };
};

const decoder = new TextDecoder();
function attr(node: Element, name: string) { return node.getAttribute(name) || ""; }
function columnIndex(ref: string) {
  const letters = (ref.match(/^[A-Z]+/i)?.[0] || "A").toUpperCase();
  let n = 0;
  for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}
async function unzipEntries(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This file is not a valid .xlsx workbook.");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries = new Map<string, { method: number; size: number; offset: number }>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("The Excel archive directory is damaged.");
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLength));
    entries.set(name, { method, size, offset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return async (name: string): Promise<string> => {
    const entry = entries.get(name);
    if (!entry) throw new Error("Workbook is missing " + name + ".");
    const start = entry.offset;
    const nameLength = view.getUint16(start + 26, true);
    const extraLength = view.getUint16(start + 28, true);
    const dataStart = start + 30 + nameLength + extraLength;
    const compressedSize = view.getUint32(entries.get(name)!.offset + 18, true);
    const compressed = new Uint8Array(buffer, dataStart, compressedSize);
    let bytes: Uint8Array;
    if (entry.method === 0) bytes = compressed;
    else if (entry.method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read compressed Excel workbooks. Please use a current version of Chrome or Edge.");
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error("This Excel workbook uses an unsupported compression method.");
    if (bytes.byteLength !== entry.size) throw new Error("A workbook component could not be decompressed correctly.");
    return decoder.decode(bytes);
  };
}
function xml(text: string) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("An Excel worksheet contains invalid XML.");
  return doc;
}
function textOf(node: Element) {
  return Array.from(node.getElementsByTagName("t")).map((item) => item.textContent || "").join("");
}
export async function readXlsx(file: File): Promise<WorkbookSheet[]> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Please choose an .xlsx Excel workbook (not .xls or .xlsm).");
  if (file.size > 15 * 1024 * 1024) throw new Error("The workbook is larger than the 15 MB import limit.");
  const read = await unzipEntries(await file.arrayBuffer());
  const workbook = xml(await read("xl/workbook.xml"));
  const rels = xml(await read("xl/_rels/workbook.xml.rels"));
  const targets = new Map(Array.from(rels.getElementsByTagName("Relationship")).map((r) => [attr(r, "Id"), attr(r, "Target")]));
  let shared: string[] = [];
  try {
    const sharedDoc = xml(await read("xl/sharedStrings.xml"));
    shared = Array.from(sharedDoc.getElementsByTagName("si")).map(textOf);
  } catch { shared = []; }
  const sheets: WorkbookSheet[] = [];
  for (const sheet of Array.from(workbook.getElementsByTagName("sheet"))) {
    const name = attr(sheet, "name");
    const target = targets.get(sheet.getAttribute("r:id") || sheet.getAttribute("id") || "");
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    const doc = xml(await read(path));
    const rows: string[][] = [];
    for (const row of Array.from(doc.getElementsByTagName("row"))) {
      const cells: string[] = [];
      for (const cell of Array.from(row.children).filter((el) => el.tagName === "c")) {
        const index = columnIndex(attr(cell, "r"));
        const type = attr(cell, "t");
        const value = cell.getElementsByTagName("v")[0]?.textContent || "";
        let result = value;
        if (type === "s") result = shared[Number(value)] || "";
        else if (type === "inlineStr") result = textOf(cell);
        else if (type === "b") result = value === "1" ? "TRUE" : "FALSE";
        if (index >= 0) cells[index] = result;
      }
      if (cells.some((v) => String(v || "").trim())) rows.push(cells.map((v) => String(v || "")));
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
function records(sheet: WorkbookSheet | undefined) {
  if (!sheet || sheet.rows.length < 2) return [];
  const headers = sheet.rows[0].map((h) => h.trim());
  return sheet.rows.slice(1).map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] || ""])))
    .filter((item) => Object.values(item).some((v) => String(v).trim()));
}
export function mapScreeningWorkbook(sheets: WorkbookSheet[]): ScreeningWorkbook {
  const screeningSheet = sheets.find((s) => s.name.trim().toLowerCase() === "screening log");
  const evidenceSheet = sheets.find((s) => s.name.trim().toLowerCase() === "evidence extraction");
  const verificationSheet = sheets.find((s) => s.name.trim().toLowerCase() === "source verification");
  if (!screeningSheet) throw new Error('The workbook must contain a worksheet named "Screening Log".');
  const screening = records(screeningSheet);
  const evidence = records(evidenceSheet);
  const verification = records(verificationSheet);
  if (!screening.length) throw new Error('The "Screening Log" worksheet contains no study records.');
  return { screening, evidence, verification, sheetCounts: { screening: screening.length, evidence: evidence.length, verification: verification.length } };
}
