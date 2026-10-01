import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const BLOCK = /```(python-run|javascript-run|js-run)\s*\n([\s\S]*?)```/gi;

export function extractRunnableBlocks(text: string) {
  const blocks: { language: "python" | "javascript"; code: string }[] = [];
  for (const match of text.matchAll(BLOCK)) {
    const tag = match[1].toLowerCase();
    const code = match[2].trim();
    if (!code) continue;
    blocks.push({ language: tag.startsWith("python") ? "python" : "javascript", code });
  }
  return blocks.slice(0, 3);
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms.`, code: 124 });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 20000) stdout = stdout.slice(0, 20000) + "\n…";
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8000) stderr = stderr.slice(0, 8000) + "\n…";
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: error.message, code: 1 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function which(binaries: string[]) {
  for (const binary of binaries) {
    const result = await runCommand(process.platform === "win32" ? "where" : "which", [binary], os.tmpdir(), 4000);
    if (result.code === 0) return binary;
  }
  return null;
}

export async function runCodeBlocks(text: string) {
  const blocks = extractRunnableBlocks(text);
  if (!blocks.length) return "";
  const outputs: string[] = [];
  for (const block of blocks) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qv7-code-"));
    try {
      if (block.language === "python") {
        const file = path.join(dir, `${randomUUID()}.py`);
        await fs.promises.writeFile(file, block.code, "utf8");
        const python = await which(["python", "python3", "py"]);
        if (!python) {
          outputs.push("Python is not installed on this server.");
          continue;
        }
        const result = await runCommand(python, [file], dir, 12000);
        outputs.push([result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.code})`);
      } else {
        const file = path.join(dir, `${randomUUID()}.mjs`);
        await fs.promises.writeFile(file, block.code, "utf8");
        const result = await runCommand("node", [file], dir, 12000);
        outputs.push([result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(exit ${result.code})`);
      }
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
  return outputs.map((item, index) => `Run ${index + 1}:\n${item}`).join("\n\n");
}
