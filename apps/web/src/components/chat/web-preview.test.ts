import assert from "node:assert/strict";
import test from "node:test";
import { canvasPreviewKind, cssPreviewSrcDoc, reactPreviewSrcDoc, scriptPreviewSrcDoc } from "./web-preview";

test("web languages get a canvas preview", () => {
  assert.equal(canvasPreviewKind("react", "tsx"), "react");
  assert.equal(canvasPreviewKind("javascript", "jsx"), "react");
  assert.equal(canvasPreviewKind("javascript", "js"), "script");
  assert.equal(canvasPreviewKind("typescript", "ts"), "script");
  assert.equal(canvasPreviewKind("css", "css"), "css");
  assert.equal(canvasPreviewKind("sql", "sql"), "source");
  assert.equal(canvasPreviewKind("code", "python"), "source");
  assert.equal(canvasPreviewKind("json", "json"), "source");
});

test("jsx compiles in the browser preview and stays off the server origin", () => {
  const html = reactPreviewSrcDoc('import React from "react";\nexport default function App(){ return <p className="p-4">Hi</p> }\n');
  assert.match(html, /React\.createElement/);
  assert.equal(html.includes("export default"), false);
  assert.equal(html.includes("allow-same-origin"), false);
  assert.match(html, /react-dom@18\.3\.1\/umd\/react-dom\.production\.min\.js/);
  assert.match(html, /ReactDOM\.createRoot/);
  assert.equal(html.includes('type="module"'), false);
});

test("react router imports such as Outlet are provided in the preview", () => {
  const html = reactPreviewSrcDoc('import { Outlet, Link } from "react-router-dom";\nexport default function Layout(){ return <div><Link to="/">Home</Link><Outlet /></div> }\n');
  assert.match(html, /var Outlet =/);
  assert.match(html, /var Link =/);
  assert.equal(html.includes('from "react-router-dom"'), false);
});

test("react itself is the loaded React, and hooks exist before the component", () => {
  const html = reactPreviewSrcDoc('import React, { useState } from "react";\nimport { Menu } from "lucide-react";\nimport clsx from "clsx";\nimport Header from "./Header";\nexport default function App(){ const [n, setN] = useState(0); return <button className={clsx("p-4")} onClick={() => setN(n + 1)}><Header /><Menu />{n}</button> }\n');
  assert.match(html, /var React = window\.React/);
  assert.equal(html.includes("React.React"), false);
  assert.match(html, /var useState = React\.useState/);
  assert.match(html, /var Menu =/);
  assert.match(html, /var clsx =/);
  assert.match(html, /var Header =/);
  const hooks = html.indexOf("var useState = React.useState");
  const component = html.indexOf("function App");
  assert.equal(hooks > -1 && component > hooks, true);
});

test("javascript and css previews do not share the app origin", () => {
  const script = scriptPreviewSrcDoc('console.log("ready")', "js");
  assert.match(script, /console\.log\("ready"\)/);
  assert.equal(script.includes("allow-same-origin"), false);
  const css = cssPreviewSrcDoc("button { color: red }");
  assert.match(css, /button \{ color: red \}/);
  assert.equal(css.includes("<script"), false);
});
