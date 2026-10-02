import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { buildDocx, preferredDocumentExt, readDocxText, takeDocument } from "./documents.ts";

test("reads a document fence and builds a docx zip", () => {
  const taken = takeDocument("Here is the file.\n\n```document\nfilename: Notes.docx\n# Notes\n\nHello\n```\n", "md");
  assert.equal(taken?.filename, "Notes.docx");
  assert.match(taken?.body || "", /Hello/);
  assert.match(taken?.rest || "", /Here is the file/);
  assert.equal(buildDocx("# Notes\n\nHello").subarray(0, 2).toString(), "PK");
  assert.equal(preferredDocumentExt("make a word file"), "docx");
  assert.equal(preferredDocumentExt("write this up"), "docx");
  assert.match(readDocxText(buildDocx("# Notes\n\nHello world")), /Hello world/);
  assert.match(readDocxText(deflatedDocx("Compressed hello")), /Compressed hello/);
});

function deflatedDocx(text: string) {
  const xml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const data = deflateRawSync(xml);
  const name = Buffer.from("word/document.xml");
  const crc = 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(xml.length, 22);
  local.writeUInt16LE(name.length, 26);
  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(20, 4);
  dir.writeUInt16LE(20, 6);
  dir.writeUInt16LE(8, 10);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(data.length, 20);
  dir.writeUInt32LE(xml.length, 24);
  dir.writeUInt16LE(name.length, 28);
  dir.writeUInt32LE(0, 42);
  const central = Buffer.concat([dir, name]);
  const offset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([local, name, data, central, end]);
}
