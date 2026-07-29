import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const htmlFiles = (await readdir(root)).filter(file => file.endsWith(".html")).sort();
const read = file => readFile(path.join(root, file), "utf8");
const pageScriptCache = new Map();

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

async function pageJavaScript(file, html = null) {
  if (pageScriptCache.has(file)) return pageScriptCache.get(file);
  const source = html ?? await read(file);
  const scripts = [...source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(match => localTarget(match[1]))
    .filter(target => target.endsWith(".js"));
  const externalSources = await Promise.all(scripts.map(target => readFile(path.join(root, target), "utf8")));
  const inlineSources = [...source.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]);
  const combined = [...externalSources, ...inlineSources].join("\n");
  pageScriptCache.set(file, combined);
  return combined;
}

function pageIds(html) {
  return new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]));
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

test("every hooked button is referenced by JavaScript loaded on its page", async () => {
  const unimplemented = [];

  for (const file of htmlFiles) {
    const html = await read(file);
    const loadedJavaScript = await pageJavaScript(file, html);
    for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
      const attributes = match[1];
      if (/\btype\s*=\s*["'](?:submit|reset)["']/i.test(attributes)) continue;
      if (/\bclass\s*=\s*["'][^"']*\bmenu-toggle\b/i.test(attributes)) {
        if (!loadedJavaScript.includes(".menu-toggle")) unimplemented.push(`${file}: menu-toggle`);
        continue;
      }
      const hooks = [...attributes.matchAll(/\b(data-[a-z0-9_-]+)(?:\s|=|$)/gi)].map(hook => hook[1]);
      if (!hooks.length || hooks.some(hook => loadedJavaScript.includes(hook))) continue;
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

test("local hash links resolve to an element or a target-page hash router", async () => {
  const brokenFragments = [];
  for (const file of htmlFiles) {
    const html = await read(file);
    for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*#[^"']+)["'][^>]*>/gi)) {
      const href = match[1];
      if (/^(?:https?:|mailto:|tel:|javascript:)/i.test(href)) continue;
      const [pathname, encodedFragment] = href.split("#", 2);
      const fragment = decodeURIComponent(encodedFragment || "");
      if (!fragment) continue;
      const targetFile = localTarget(pathname) || file;
      const targetHtml = await read(targetFile);
      if (pageIds(targetHtml).has(fragment)) continue;
      const targetJavaScript = await pageJavaScript(targetFile, targetHtml);
      const usesHashRouting = /(?:location|window)\.hash|hashchange/i.test(targetJavaScript);
      if (!usesHashRouting || !targetJavaScript.includes(fragment)) {
        brokenFragments.push(`${file} -> ${href}`);
      }
    }
  }
  assert.deepEqual(brokenFragments, []);
});

test("ARIA controls point to elements on the same page", async () => {
  const missingTargets = [];
  for (const file of htmlFiles) {
    const html = await read(file);
    const ids = pageIds(html);
    for (const match of html.matchAll(/\baria-controls\s*=\s*["']([^"']+)["']/gi)) {
      for (const target of match[1].trim().split(/\s+/)) {
        if (target && !ids.has(target)) missingTargets.push(`${file}#${target}`);
      }
    }
  }
  assert.deepEqual(missingTargets, []);
});

test("images reserve layout space and never use an empty source", async () => {
  const imageIssues = [];
  for (const file of htmlFiles) {
    const html = await read(file);
    for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
      const attributes = match[1];
      if (!/\balt\s*=\s*["'][^"']*["']/i.test(attributes)) imageIssues.push(`${file}: missing alt`);
      if (!/\bwidth\s*=\s*["']?\d+/i.test(attributes) || !/\bheight\s*=\s*["']?\d+/i.test(attributes)) {
        imageIssues.push(`${file}: missing intrinsic dimensions`);
      }
      if (/\bsrc\s*=\s*["']\s*["']/i.test(attributes)) imageIssues.push(`${file}: empty src`);
    }
  }
  assert.deepEqual(imageIssues, []);
});

test("new-tab links prevent opener access", async () => {
  const unsafeLinks = [];
  for (const file of htmlFiles) {
    const html = await read(file);
    for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
      const attributes = match[1];
      if (!/\btarget\s*=\s*["']_blank["']/i.test(attributes)) continue;
      if (!/\brel\s*=\s*["'][^"']*\bnoopener\b[^"']*["']/i.test(attributes)) {
        unsafeLinks.push(`${file}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(unsafeLinks, []);
});

test("shared assets use one cache-busting URL across the site", async () => {
  const versionsByAsset = new Map();
  const missingVersions = [];
  for (const file of htmlFiles) {
    const html = await read(file);
    for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["'](assets\/(?:css|js)\/[^"'?#]+)(\?[^"'#]+)?["']/gi)) {
      const asset = match[1];
      const query = match[2] || "";
      if (!query) missingVersions.push(`${file}: ${asset}`);
      if (!versionsByAsset.has(asset)) versionsByAsset.set(asset, new Set());
      versionsByAsset.get(asset).add(query);
    }
  }
  const conflicts = [...versionsByAsset.entries()]
    .filter(([, versions]) => versions.size > 1)
    .map(([asset, versions]) => `${asset}: ${[...versions].join(", ")}`);
  assert.deepEqual(missingVersions, []);
  assert.deepEqual(conflicts, []);
});

test("pages load the legal and social footer directly once", async () => {
  const footerIssues = [];
  for (const file of htmlFiles) {
    const html = await read(file);
    const references = [...html.matchAll(/\bsrc\s*=\s*["']assets\/js\/social-footer\.js(?:\?[^"']*)?["']/gi)];
    if (references.length !== 1) footerIssues.push(`${file}: ${references.length} social footer scripts`);
  }
  assert.deepEqual(footerIssues, []);
});

test("web manifest, sitemap, and robots references stay valid", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.webmanifest"), "utf8"));
  const manifestStart = String(manifest.start_url || "").trim() === "/"
    ? "index.html"
    : localTarget(manifest.start_url);
  const referencedFiles = [
    ...(manifest.icons || []).map(icon => localTarget(icon.src)),
    manifestStart
  ].filter(Boolean);
  const missing = [];
  for (const target of referencedFiles) {
    try {
      await access(path.join(root, target));
    } catch {
      missing.push(`manifest.webmanifest -> ${target}`);
    }
  }

  const sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");
  for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    const url = new URL(match[1]);
    const target = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "index.html";
    try {
      await access(path.join(root, target));
    } catch {
      missing.push(`sitemap.xml -> ${url.pathname}`);
    }
  }

  const robots = await readFile(path.join(root, "robots.txt"), "utf8");
  assert.match(robots, /^Sitemap:\s*https:\/\/crackpacks\.com\/sitemap\.xml\s*$/im);
  assert.deepEqual(missing, []);
});
