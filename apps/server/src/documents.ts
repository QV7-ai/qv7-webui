import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const EXTS = new Set(["md", "txt", "csv", "html", "docx"]);

function crc32(buf: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Buffer }[]) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, file.data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(file.data.length, 20);
    dir.writeUInt32LE(file.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

function xml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildDocx(markdown: string) {
  const paragraphs = markdown.replace(/\r\n/g, "\n").split("\n");
  const body = paragraphs
    .map((line) => {
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      const text = heading ? heading[2] : line;
      const bold = heading ? "<w:b/>" : "";
      const size = heading ? (heading[1].length === 1 ? "32" : "28") : "22";
      return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr>${bold}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
    })
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  return zipStore([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
    },
    { name: "word/document.xml", data: Buffer.from(document) },
  ]);
}

function zipEntry(buf: Buffer, wanted: string) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && pos + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(pos + 10);
    const size = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOff = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8").replace(/\\/g, "/");
    pos += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    const localName = buf.readUInt16LE(localOff + 26);
    const localExtra = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + localName + localExtra;
    const compressed = buf.subarray(start, start + size);
    if (method === 0) return compressed;
    if (method === 8) return inflateRawSync(compressed);
    return null;
  }
  return null;
}

function decodeXml(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function readDocxText(buf: Buffer) {
  const xml = zipEntry(buf, "word/document.xml");
  if (!xml) throw new Error("That Word file could not be read. Save it as .docx and try again.");
  const text = decodeXml(
    xml
      .toString("utf8")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) throw new Error("That Word file has no readable text.");
  return text;
}

export function safeDocumentName(raw: string, fallbackExt = "md") {
  const base = path.basename(String(raw || "").replace(/[\\/]/g, "")).replace(/[^\w.\- ()]+/g, "").trim().slice(0, 80);
  const ext = (base.match(/\.([a-z0-9]+)$/i)?.[1] || fallbackExt).toLowerCase();
  const allowed = EXTS.has(ext) ? ext : fallbackExt;
  const stem = (base.replace(/\.[a-z0-9]+$/i, "") || "Document").slice(0, 60);
  return `${stem}.${allowed}`;
}

export function preferredDocumentExt(message: string) {
  if (/\b(csv|spreadsheet|tabel)\b/i.test(message)) return "csv";
  if (/\b(plain text|\.txt|tekstbestand)\b/i.test(message)) return "txt";
  if (/\bhtml\b/i.test(message)) return "html";
  return "docx";
}

export function takeDocument(text: string, fallbackExt = "md") {
  const match = text.match(/```(?:document|file|docx|markdown|md|txt|csv|html)\s*\n([\s\S]*?)```/i);
  if (match && match.index != null) {
    let body = match[1].replace(/^\uFEFF/, "");
    let filename = "";
    const nameLine = body.match(/^\s*(?:filename|file|name)\s*:\s*(.+)\s*\n/i);
    if (nameLine) {
      filename = nameLine[1].trim();
      body = body.slice(nameLine[0].length);
    }
    const lang = match[0].match(/```(\w+)/)?.[1]?.toLowerCase() || "";
    const ext = lang === "csv" || lang === "txt" || lang === "html" || lang === "docx" ? lang : fallbackExt;
    const rest = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.replace(/\n{3,}/g, "\n\n").trim();
    return { filename: safeDocumentName(filename, ext), body: body.trim(), rest };
  }
  const body = text.trim();
  if (body.length < 40) return null;
  const heading = body.match(/^#{1,3}\s+(.+)$/m)?.[1];
  const sentence = body.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 160) || "Document";
  return { filename: safeDocumentName(heading || "", fallbackExt), body, rest: sentence };
}

export async function materializeDocument(uploadsDir: string, content: string, userMessage: string) {
  const preferred = preferredDocumentExt(userMessage);
  const taken = takeDocument(content, preferred);
  if (!taken?.body) return null;
  const filename =
    preferred === "docx" ? taken.filename.replace(/\.(md|markdown)$/i, ".docx") : taken.filename;
  const ext = filename.split(".").pop() || "md";
  const stored = `${randomUUID()}.${ext}`;
  const data = ext === "docx" ? buildDocx(taken.body) : Buffer.from(taken.body, "utf8");
  if (data.length > 500_000) return null;
  await fs.promises.writeFile(path.join(uploadsDir, stored), data);
  const marker = `[[doc:/api/uploads/${stored}|${filename.replace(/[|\]]/g, "")}]]`;
  return { content: `${taken.rest}\n\n${marker}`.trim() };
}
