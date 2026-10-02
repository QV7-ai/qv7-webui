import { transform } from "sucrase";
import type { ArtifactType } from "@wlfv/shared";

export type CanvasPreviewKind = "html" | "svg" | "markdown" | "css" | "script" | "react" | "source";

const REACT_URL = "https://unpkg.com/react@18.3.1/umd/react.production.min.js";
const REACT_DOM_URL = "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js";

export function canvasPreviewKind(type: ArtifactType, language: string): CanvasPreviewKind | null {
  const lang = language.trim().toLowerCase();
  if (type === "html" || lang === "html") return "html";
  if (type === "svg" || lang === "svg") return "svg";
  if (type === "markdown" || lang === "md" || lang === "markdown") return "markdown";
  if (type === "css" || lang === "css") return "css";
  if (type === "react" || lang === "jsx" || lang === "tsx") return "react";
  if (type === "javascript" || type === "typescript" || lang === "js" || lang === "javascript" || lang === "ts" || lang === "typescript") return "script";
  return "source";
}

function safeScript(code: string) {
  return code.replace(/<\/script/gi, "<\\/script");
}

function safeStyle(code: string) {
  return code.replace(/<\/style/gi, "<\\/style");
}

function errorPage(message: string) {
  const text = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html><html><body style="margin:0;padding:16px;font:14px sans-serif;color:#b91c1c;white-space:pre-wrap">${text}</body></html>`;
}

const CLASS_JOIN = `function () {
  var join = function (value) {
    if (!value) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(join).filter(Boolean).join(" ");
    if (typeof value === "object") return Object.keys(value).filter(function (key) { return value[key]; }).join(" ");
    return "";
  };
  return Array.prototype.map.call(arguments, join).filter(Boolean).join(" ");
}`;

const COMPONENT_STUB = "function (props) { return React.createElement('div', null, props && props.children); }";

const ICON_STUB = `function (props) {
  return React.createElement("svg", { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "aria-hidden": "true", className: props && props.className },
    React.createElement("circle", { cx: 12, cy: 12, r: 8 }));
}`;

type ImportBinding = { local: string; imported: string; pkg: string };

function importBindings(source: string): ImportBinding[] {
  const out: ImportBinding[] = [];
  const seen = new Set<string>();
  const add = (local: string, imported: string, pkg: string) => {
    if (!/^[A-Za-z_$][\w$]*$/.test(local) || seen.has(local)) return;
    seen.add(local);
    out.push({ local, imported, pkg });
  };
  for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g)) {
    if (/^\s*import\s+type\b/.test(match[0])) continue;
    const pkg = match[2];
    const clause = match[1].trim();
    const namespace = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (namespace) {
      add(namespace[1], "*", pkg);
      continue;
    }
    const named = clause.match(/\{([^}]*)\}/);
    const before = (named ? clause.slice(0, named.index) : clause).replace(/,/g, "").trim();
    if (/^[A-Za-z_$][\w$]*$/.test(before)) add(before, "default", pkg);
    if (!named) continue;
    for (const part of named[1].split(",")) {
      const piece = part.replace(/\btype\b/g, "").trim();
      if (!piece) continue;
      const bits = piece.split(/\s+as\s+/).map((item) => item.trim()).filter(Boolean);
      const imported = bits[0];
      const local = bits[1] || bits[0];
      if (imported && local) add(local, imported, pkg);
    }
  }
  return out;
}

function previewStub(name: string) {
  if (name === "Link" || name === "NavLink") {
    return "function (props) { return React.createElement('a', { href: (props && (props.to || props.href)) || '#' }, props && props.children); }";
  }
  if (name === "Navigate") return "function () { return null; }";
  if (name === "Route") return "function (props) { return React.createElement(React.Fragment, null, props && props.element, props && props.children); }";
  if (name === "Routes" || name === "BrowserRouter" || name === "HashRouter" || name === "MemoryRouter" || name === "Router" || name === "AnimatePresence") {
    return COMPONENT_STUB;
  }
  if (name === "useNavigate") return "function () { return function () {}; }";
  if (name === "useParams" || name === "useMatches") return "function () { return {}; }";
  if (name === "useLocation") return "function () { return { pathname: '/', search: '', hash: '', state: null, key: 'preview' }; }";
  if (name === "useSearchParams") return "function () { return [new URLSearchParams(), function () {}]; }";
  if (name === "useForm" || name === "useFormStatus" || name === "useFormState") return "function () { return [{}, function () {}]; }";
  if (name.startsWith("use")) return "function () { return {}; }";
  if (name === "clsx" || name === "cn" || name === "classNames" || name === "twMerge" || name === "twJoin") return CLASS_JOIN;
  if (name === "cva") return "function () { return function () { return ''; }; }";
  return COMPONENT_STUB;
}

function bindingExpr(binding: ImportBinding) {
  const { imported, local, pkg } = binding;
  if (pkg === "react" || pkg === "react/jsx-runtime" || pkg === "react/jsx-dev-runtime") {
    if (imported === "default" || imported === "*" || local === "React") return "window.React";
    return `window.React.${imported}`;
  }
  if (pkg === "react-dom" || pkg === "react-dom/client") {
    if (imported === "default" || imported === "*") return "window.ReactDOM";
    return `window.ReactDOM.${imported}`;
  }
  if (pkg === "clsx" || pkg === "classnames" || local === "clsx" || local === "cn" || local === "classNames" || local === "twMerge" || local === "twJoin") return CLASS_JOIN;
  if (local === "cva" || pkg.includes("class-variance-authority")) return "function () { return function () { return ''; }; }";
  if (pkg === "framer-motion" && (imported === "motion" || imported === "default" || imported === "*")) {
    return `new Proxy({}, { get: function (_, tag) { return function (props) { var name = typeof tag === "string" ? tag : "div"; return React.createElement(name, props, props && props.children); }; } })`;
  }
  if (/lucide|heroicons|react-icons|phosphor-icons|tabler/.test(pkg)) {
    if (imported === "*" || imported === "default") {
      return `new Proxy({}, { get: function () { return (${ICON_STUB}); } })`;
    }
    return ICON_STUB;
  }
  if (pkg === "next/image") return "function (props) { return React.createElement('img', { src: (props && props.src) || '', alt: (props && props.alt) || '' }); }";
  if (pkg === "next/link" || pkg === "next/navigation") return previewStub(imported === "default" ? "Link" : imported);
  if (/\.(css|scss|sass|less)$/.test(pkg)) return `new Proxy({}, { get: function (_, key) { return String(key); } })`;
  if (/\.(png|jpe?g|gif|svg|webp|avif|ico)$/.test(pkg)) return JSON.stringify(pkg);
  if (pkg.endsWith(".json")) return "{}";
  if (imported === "*") {
    return `new Proxy({}, { get: function (_, key) { var name = String(key); if (name.indexOf("use") === 0) return function () { return {}; }; return function (props) { return React.createElement("div", null, props && props.children); }; } })`;
  }
  return previewStub(imported === "default" ? local : imported);
}

const PRELUDE_NAMES = new Set(["React", "ReactDOM", "useState", "useEffect", "useRef", "useMemo", "useCallback", "useId", "useReducer", "useContext", "useLayoutEffect", "useImperativeHandle", "useDebugValue", "useSyncExternalStore", "useInsertionEffect", "useTransition", "useDeferredValue", "Fragment", "createElement", "Component", "PureComponent", "memo", "forwardRef", "lazy", "Suspense", "StrictMode", "createContext", "cloneElement", "Children", "isValidElement", "startTransition", "createRoot", "hydrateRoot"]);

function previewRuntime(source: string) {
  const lines = [
    "var React = window.React;",
    "var ReactDOM = window.ReactDOM;",
    "var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef, useMemo = React.useMemo, useCallback = React.useCallback, useId = React.useId, useReducer = React.useReducer, useContext = React.useContext, useLayoutEffect = React.useLayoutEffect, useImperativeHandle = React.useImperativeHandle, useDebugValue = React.useDebugValue, useSyncExternalStore = React.useSyncExternalStore, useInsertionEffect = React.useInsertionEffect, useTransition = React.useTransition, useDeferredValue = React.useDeferredValue;",
    "var Fragment = React.Fragment, createElement = React.createElement, Component = React.Component, PureComponent = React.PureComponent, memo = React.memo, forwardRef = React.forwardRef, lazy = React.lazy, Suspense = React.Suspense, StrictMode = React.StrictMode, createContext = React.createContext, cloneElement = React.cloneElement, Children = React.Children, isValidElement = React.isValidElement, startTransition = React.startTransition;",
    "var createRoot = ReactDOM.createRoot, hydrateRoot = ReactDOM.hydrateRoot;",
  ];
  for (const binding of importBindings(source)) {
    if (PRELUDE_NAMES.has(binding.local)) continue;
    lines.push(`var ${binding.local} = (${bindingExpr(binding)});`);
  }
  return lines.join("\n");
}

function prepareModule(source: string) {
  return source
    .replace(/^\s*import\s+type\b[^\n]*$/gm, "")
    .replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    .replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    .replace(/export\s+default\s+/g, "var __qv7Default = ")
    .replace(/export\s+(const|let|var|function|class|enum)\s+/g, "$1 ")
    .replace(/export\s*\{([^}]*)\}\s*;?/g, (_, body: string) => {
      const named = body.match(/([A-Za-z_$][\w$]*)\s+as\s+default/);
      return named ? `var __qv7Default = ${named[1]};` : "";
    });
}

export function reactPreviewSrcDoc(source: string) {
  try {
    const compiled = transform(prepareModule(source), {
      transforms: ["typescript", "jsx"],
      jsxRuntime: "classic",
      production: true,
      disableESTransforms: true,
    }).code;
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script>
<style>html,body{margin:0;background:#fff;color:#111}</style>
</head>
<body>
<pre id="qv7-err" style="margin:0;padding:16px;color:#b91c1c;white-space:pre-wrap"></pre>
<div id="root"></div>
<script src="${REACT_URL}"></script>
<script src="${REACT_DOM_URL}"></script>
<script>
function __qv7Show(message) {
  var node = document.getElementById("qv7-err");
  if (node) node.textContent = message;
}
if (!window.React || !window.ReactDOM || !window.ReactDOM.createRoot) {
  __qv7Show("Could not load React for this preview.");
} else {
  try {
${previewRuntime(source)}
${safeScript(compiled)}
    var __qv7Comp = typeof __qv7Default !== "undefined" ? __qv7Default : typeof App !== "undefined" ? App : null;
    if (!__qv7Comp) throw new Error("Add a default export to preview this component.");
    class __qv7Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error: error };
      }
      render() {
        if (this.state.error) return React.createElement("pre", { style: { color: "#b91c1c", padding: 16, whiteSpace: "pre-wrap" } }, this.state.error.message || String(this.state.error));
        return React.createElement(__qv7Comp, null);
      }
    }
    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(__qv7Boundary));
  } catch (error) {
    __qv7Show(error && error.message ? error.message : String(error));
  }
}
</script>
</body>
</html>`;
  } catch (error) {
    return errorPage(error instanceof Error ? error.message : "Could not preview this file.");
  }
}

export function scriptPreviewSrcDoc(source: string, language: string) {
  const lang = language.trim().toLowerCase();
  let code = source;
  if (lang === "ts" || lang === "typescript" || lang === "tsx") {
    try {
      code = transform(prepareModule(source), { transforms: ["typescript"], disableESTransforms: true }).code;
    } catch (error) {
      return errorPage(error instanceof Error ? error.message : "Could not preview this file.");
    }
  } else {
    code = prepareModule(source);
  }
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0">
<pre id="qv7-log" style="margin:0;padding:16px;font:13px ui-monospace,monospace;white-space:pre-wrap"></pre>
<script>
const __log = document.getElementById("qv7-log");
console.log = (...args) => { __log.textContent += args.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" ") + "\\n"; };
try {
${safeScript(code)}
} catch (error) {
  __log.textContent += error && error.message ? error.message : String(error);
}
</script>
</body>
</html>`;
}

export function sourcePreviewText(source: string, language: string) {
  if (language.trim().toLowerCase() !== "json" && !source.trim().startsWith("{") && !source.trim().startsWith("[")) return source;
  try {
    return JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    return source;
  }
}

export function cssPreviewSrcDoc(source: string) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${safeStyle(source)}
</style>
</head>
<body>
  <h1>Heading</h1>
  <p>The stylesheet in this canvas is applied to this page. <a href="#">Link</a></p>
  <button type="button">Button</button>
  <div class="card">Card</div>
</body>
</html>`;
}
