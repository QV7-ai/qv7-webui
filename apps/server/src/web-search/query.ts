const SKIP = new Set([
  "the", "and", "with", "but", "its", "some", "more", "about", "for", "from", "into", "onto", "this", "that", "these", "those",
  "your", "you", "our", "are", "was", "were", "been", "have", "has", "had", "not", "can", "will", "just", "very", "really",
  "een", "van", "met", "voor", "over", "naar", "dit", "dat", "deze", "die", "ook", "niet", "wel", "zijn", "wordt", "hun",
  "haar", "als", "bij", "uit", "tot", "wat", "hoe", "waarom", "wanneer", "waar", "wie", "what", "how", "why", "when", "where", "who",
  "make", "add", "look", "recreate", "rebuild", "remake", "rewrite", "create", "build", "write", "generate", "page", "pages",
  "website", "webpage", "canvas", "document", "documentation", "information", "info", "much", "please", "still", "like", "feel",
  "using", "use", "style", "styled", "styling", "css", "html", "tailwind", "font", "awesome", "icon", "icons", "google", "fonts",
  "maak", "hermaak", "opnieuw", "schrijf", "pagina", "informatie", "meer", "veel", "graag", "dutch", "nederlands", "english", "engels",
  "onderzoek", "research", "report", "verslag", "study", "studie", "overview", "guide", "gids", "home", "welcome", "untitled",
  "documentatie",
]);

const MARKUP = new Set([
  "doctype", "html", "head", "meta", "charset", "utf", "utf8", "viewport", "stylesheet", "href", "script", "src",
  "classname", "tailwind", "cdnjs", "fontawesome", "div", "span", "lang", "flex", "grid", "rounded", "shadow",
  "const", "function", "return", "import", "export", "async", "await", "undefined", "null", "svg", "path", "xmlns",
  "content", "width", "device", "initial", "scale", "title", "link", "rel", "name", "body", "class", "style", "media",
  "devicewidth", "initialscale", "px", "py", "margin", "padding", "color", "fontfamily",
]);

const GENUS_SKIP = new Set(["bruine", "brown", "black", "polar", "the", "van", "het", "een", "de"]);

function isMarkupToken(word: string) {
  const key = word.toLowerCase();
  if (MARKUP.has(key) || MARKUP.has(key.replace(/-/g, ""))) return true;
  const parts = key.split("-").filter(Boolean);
  return parts.length > 1 && parts.every((part) => MARKUP.has(part) || SKIP.has(part) || part.length < 3);
}

function isSkipped(word: string) {
  const key = word.toLowerCase();
  if (key.length < 3 || SKIP.has(key) || isMarkupToken(word)) return true;
  const parts = key.split("-").filter(Boolean);
  return parts.length > 1 && parts.every((part) => SKIP.has(part) || MARKUP.has(part) || part.length < 3);
}

function visibleText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|nbsp|quot|#39);/g, " ");
}

function contentWords(text: string) {
  const seen = new Set<string>();
  const words: string[] = [];
  const plain = text.replace(/[^a-z0-9\u00c0-\u024f\s-]+/gi, " ");
  for (const word of plain.split(/\s+/)) {
    const key = word.toLowerCase();
    if (isSkipped(word) || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words;
}

function findBinomial(text: string) {
  for (const match of text.matchAll(/\b([A-Z][a-z]{2,})\s+([a-z]{4,})\b/g)) {
    const genus = match[1].toLowerCase();
    const species = match[2].toLowerCase();
    if (GENUS_SKIP.has(genus) || SKIP.has(genus) || SKIP.has(species) || MARKUP.has(species)) continue;
    return `${match[1]} ${match[2]}`;
  }
  return "";
}

function pasteStart(raw: string) {
  const htmlAt = raw.search(/<!doctype\b|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]|<div[\s>]|<section[\s>]/i);
  const fenceAt = raw.search(/```/);
  const cuts = [htmlAt, fenceAt].filter((index) => index >= 0);
  if (cuts.length) return Math.min(...cuts);
  if (raw.length > 500) {
    const heading = raw.search(/\n#{1,3}\s+\S/);
    if (heading > 0 && heading < 400) return heading;
  }
  return -1;
}

export function queryIsNoise(query: string) {
  const raw = String(query || "").trim();
  if (!raw) return true;
  if (/```|<\w|https?:\/\/|\{[^}]{8,}\}/.test(raw)) return true;
  const words = raw.split(/[^a-z0-9\u00c0-\u024f-]+/i).filter(Boolean);
  if (words.length > 16) return true;
  const hits = words.filter((word) => isMarkupToken(word)).length;
  return hits >= 3 && hits / words.length >= 0.35;
}

export function focusSearchText(text: string) {
  const raw = String(text || "");
  const wiki = /\bwikipedia\b/i.test(raw);
  const cut = pasteStart(raw);
  let instruction = raw;
  let subjectWords: string[] = [];
  let binomialWords: string[] = [];
  if (cut >= 0) {
    instruction = raw.slice(0, cut);
    const block = raw.slice(cut);
    const title = block.match(/<title[^>]*>([^<]{2,160})<\/title>/i)?.[1] || "";
    const heading = block.match(/<h1[^>]*>([^<]{2,160})<\/h1>/i)?.[1] || block.match(/^#{1,3}[ \t]+(.+)$/m)?.[1] || "";
    subjectWords = contentWords(`${heading} ${title}`);
    const binomial = findBinomial(visibleText(block).slice(0, 2500));
    binomialWords = binomial ? binomial.split(" ") : [];
  }
  const instructionWords = contentWords(visibleText(instruction));
  const have = new Set<string>();
  const words: string[] = [];
  const push = (word: string) => {
    const key = word.toLowerCase();
    if (have.has(key)) return;
    have.add(key);
    words.push(word);
  };
  const pasted = cut >= 0 && (subjectWords.length > 0 || binomialWords.length > 0);
  for (const word of pasted ? [...subjectWords, ...binomialWords, ...instructionWords] : instructionWords) push(word);
  let query = words.slice(0, 8).join(" ");
  if (wiki && query && !/\bwikipedia\b/i.test(query)) query = `${query} wikipedia`.trim();
  return query.slice(0, 180);
}

export function sanitizeSearchQuery(query: string) {
  const raw = String(query || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (!queryIsNoise(raw)) return raw.slice(0, 180);
  return focusSearchText(raw).slice(0, 180);
}

export function resolveSearchQuery(userText: string, candidate?: string) {
  const subject = focusSearchText(userText);
  const proposed = String(candidate || "").replace(/\s+/g, " ").trim();
  if (!proposed || queryIsNoise(proposed)) return subject || sanitizeSearchQuery(proposed);
  return proposed.slice(0, 180);
}

export function cleanSearchQuery(raw: string, fallback: string) {
  const line = String(raw || "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(?:search query|query|zoekopdracht)\s*:\s*/i, "")
    .split(/\n/)
    .map((item) => item.trim())
    .find(Boolean) || "";
  const query = line.replace(/\s+/g, " ").trim().slice(0, 180);
  if (query.length < 3 || queryIsNoise(query)) return fallback.slice(0, 180);
  return query;
}
