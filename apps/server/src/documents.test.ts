import assert from "node:assert/strict";
import test from "node:test";
import { buildDocx, preferredDocumentExt, takeDocument } from "./documents.ts";

test("reads a document fence and builds a docx zip", () => {
  const taken = takeDocument("Here is the file.\n\n```document\nfilename: Notes.docx\n# Notes\n\nHello\n```\n", "md");
  assert.equal(taken?.filename, "Notes.docx");
  assert.match(taken?.body || "", /Hello/);
  assert.match(taken?.rest || "", /Here is the file/);
  assert.equal(buildDocx("# Notes\n\nHello").subarray(0, 2).toString(), "PK");
  assert.equal(preferredDocumentExt("make a word file"), "docx");
  assert.equal(preferredDocumentExt("write this up"), "md");
});
