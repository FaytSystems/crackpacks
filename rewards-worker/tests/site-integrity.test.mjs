import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const htmlFiles = (await readdir(root)).filter(file => file.endsWith(".html")).sort();
const read = file => readFile(path.join(root, file), "utf8");

function localTarget(value) {
  const target = String(value || "").trim();
  if (
    !target ||
    target.startsWith("#") ||
    target.startsWith("//") ||
    /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(target) ||
    target.includes("${")
  ) return "";
  const pathname = target.split(/[?#]/, 1)[0].replace(/^\/+/, "");
  return decodeURIComponent(pathname);
}

test("every local page, asset, and form target referenced by HTML exists", async () => {
  const missing = [];
  for (const file of htmlFiles) {
    const html = await read(file);
    for (const match of html.matchAll(/\b(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) {
      const target = localTarget(match[1]);
      if (!target) continue;
      try {
        await access(path.join(root, target));
      } catch {
        missing.push(`${file} -> ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("HTML pages do not contain duplicate element IDs", async () => {
  const duplicates = [];
  for (const file of htmlFiles) {
    const html = await read(file);
    const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
    const seen = new Set();
    ids.forEach(id => {
      if (seen.has(id)) duplicates.push(`${file}#${id}`);
      seen.add(id);
    });
  }
  assert.deepEqual(duplicates, []);
});

test("buttons expose a native action or a JavaScript hook", async () => {
  const deadButtons = [];
  for (const file of htmlFiles) {
    const html = await read(file);
    for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
      const attributes = match[1];
      const nativeAction = /\btype\s*=\s*["'](?:submit|reset)["']/i.test(attributes);
      const scriptHook = /\bdata-[a-z0-9_-]+(?:\s|=|$)/i.test(attributes);
      const controlledMenu = /\bclass\s*=\s*["'][^"']*\bmenu-toggle\b/i.test(attributes) ||
        /\baria-controls\s*=/i.test(attributes);
      const intentionallyDisabled = /\bdisabled(?:\s|>|$)/i.test(attributes);
      if (!nativeAction && !scriptHook && !controlledMenu && !intentionallyDisabled) {
        deadButtons.push(`${file}: <button${attributes}>`);
      }
    }
  }
  assert.deepEqual(deadButtons, []);
});

test("every hooked button is referenced by site JavaScript", async () => {
  const scriptDirectory = path.join(root, "assets", "js");
  const scriptFiles = (await readdir(scriptDirectory)).filter(file => file.endsWith(".js"));
  const scriptSources = await Promise.all(scriptFiles.map(file => readFile(path.join(scriptDirectory, file), "utf8")));
  const siteJavaScript = scriptSources.join("\n");
  const unimplemented = [];

  for (const file of htmlFiles) {
    const html = await read(file);
    const inlineJavaScript = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(match => match[1])
      .join("\n");
    for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
      const attributes = match[1];
      if (/\btype\s*=\s*["'](?:submit|reset)["']/i.test(attributes)) continue;
      if (/\bclass\s*=\s*["'][^"']*\bmenu-toggle\b/i.test(attributes)) {
        if (!siteJavaScript.includes(".menu-toggle")) unimplemented.push(`${file}: menu-toggle`);
        continue;
      }
      const hooks = [...attributes.matchAll(/\b(data-[a-z0-9_-]+)(?:\s|=|$)/gi)].map(hook => hook[1]);
      if (!hooks.length || hooks.some(hook => siteJavaScript.includes(hook) || inlineJavaScript.includes(hook))) continue;
      unimplemented.push(`${file}: ${hooks.join(", ")}`);
    }
  }

  assert.deepEqual(unimplemented, []);
});

test("bare hash links have a script hook instead of acting as dead links", async () => {
  const deadLinks = [];
  for (const file of htmlFiles) {
    const html = await read(file);
    for (const match of html.matchAll(/<a\b([^>]*)\bhref\s*=\s*["']#["']([^>]*)>/gi)) {
      const attributes = `${match[1]} ${match[2]}`;
      if (!/\bdata-[a-z0-9_-]+(?:\s|=|$)/i.test(attributes)) {
        deadLinks.push(`${file}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(deadLinks, []);
});
