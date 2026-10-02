const RUN = /^(?:python-run|javascript-run|js-run)$/i;

export function releaseAssistantDelta(held: string, delta: string, keepCode: boolean) {
  let buf = held + delta;
  let visible = "";
  while (buf) {
    const open = buf.indexOf("```");
    if (open < 0) {
      const tail = /`{1,2}$/.exec(buf);
      if (tail) {
        visible += buf.slice(0, -tail[0].length);
        buf = tail[0];
      } else {
        visible += buf;
        buf = "";
      }
      break;
    }
    visible += buf.slice(0, open);
    const rest = buf.slice(open);
    const headerEnd = rest.indexOf("\n");
    if (headerEnd < 0) {
      buf = rest;
      break;
    }
    const header = rest.slice(3, headerEnd).trim().toLowerCase();
    const drop = header === "tool" || header === "json" || (RUN.test(header) && !keepCode);
    const hold = drop || (RUN.test(header) && keepCode);
    if (hold) {
      const close = rest.indexOf("```", headerEnd + 1);
      if (close < 0) {
        buf = rest;
        break;
      }
      if (!drop) visible += rest.slice(0, close + 3);
      buf = rest.slice(close + 3);
      continue;
    }
    visible += "```";
    buf = rest.slice(3);
  }
  return { held: buf, visible };
}

export function flushAssistantHeld(held: string, keepCode: boolean) {
  if (!held.startsWith("```")) return held;
  const header = held.slice(3, held.indexOf("\n") < 0 ? undefined : held.indexOf("\n")).trim().toLowerCase();
  if (header === "tool" || header === "json") return "";
  if (RUN.test(header) && !keepCode) return "";
  return held;
}
