import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { artifactFilename, previewSandbox } from "@wlfv/shared";
import { CanvasPanel, artifactChatClass, artifactPanelClass } from "./CanvasPanel";
import { listCanvasVersions, type UiMessage } from "./MessageList";

test("artifact panel keeps the chat split on desktop and a full screen on a phone", () => {
  assert.match(artifactPanelClass, /md:w-\[56%\]/);
  assert.equal(artifactChatClass, "max-md:hidden");
  const html = renderToStaticMarkup(
    createElement(CanvasPanel, {
      title: "Plants",
      content: "<p>Hi</p>",
      type: "html",
      language: "html",
      saveState: "saved",
      onChange() {},
      onClose() {},
    }),
  );
  assert.match(html, /sandbox="allow-scripts"/);
  assert.equal(html.includes("allow-same-origin"), false);
  assert.match(html, /Chat/);
  assert.match(html, /Plants/);
  assert.equal(artifactFilename("Plants", "html", "html"), "Plants.html");
  assert.equal(previewSandbox("svg"), "");
});

test("version arrows and the beta line show for other languages", () => {
  const html = renderToStaticMarkup(
    createElement(CanvasPanel, {
      title: "UX Company",
      content: "export default function App(){ return <p>Hi</p> }",
      type: "react",
      language: "tsx",
      versionIndex: 1,
      versionCount: 2,
      saveState: "saved",
      onChange() {},
      onClose() {},
    }),
  );
  assert.match(html, /Canvas is in beta\. Pages can still look unfinished\./);
  assert.match(html, /2\/2/);
  const messages = [
    { id: "a", role: "assistant", content: "```artifact\ntitle: One\ntype: react\nlanguage: tsx\n\nexport default function One(){ return null }\n```" },
    { id: "b", role: "assistant", content: "```artifact\ntitle: Two\ntype: react\nlanguage: tsx\n\nexport default function Two(){ return null }\n```" },
  ] as UiMessage[];
  const versions = listCanvasVersions(messages);
  assert.equal(versions.length, 2);
  assert.equal(versions[1]?.file.title, "Two");
});

test("markdown and svg previews do not run scripts", () => {
  const markdown = renderToStaticMarkup(
    createElement(CanvasPanel, {
      title: "Note",
      content: "Hello\n\n<script>alert(1)</script>",
      type: "markdown",
      language: "md",
      onChange() {},
      onClose() {},
    }),
  );
  assert.equal(markdown.includes("<script"), false);
  assert.match(markdown, /Hello/);
  const svg = renderToStaticMarkup(
    createElement(CanvasPanel, {
      title: "Mark",
      content: "<svg><script>alert(1)</script></svg>",
      type: "svg",
      language: "svg",
      onChange() {},
      onClose() {},
    }),
  );
  assert.match(svg, /sandbox=""/);
});
