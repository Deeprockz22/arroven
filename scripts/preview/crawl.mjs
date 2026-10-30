/**
 * Crawls a running ARROVEN as one signed-in user and writes a static, read-only copy: every page as plain HTML with the
 * app's scripts removed, links made relative (so it works under any sub-path, e.g. GitHub Pages), and a small script
 * that answers every button and form with "read-only preview".
 *
 * Usage: node scripts/preview/crawl.mjs <base-url> <session-token> <out-dir>
 */
import fs from "node:fs/promises";
import path from "node:path";

const [base, token, outDir] = process.argv.slice(2);
if (!base || !token || !outDir) throw new Error("Usage: crawl.mjs <base-url> <session-token> <out-dir>");
const headers = { cookie: `arroven_session=${token}` };
const SKIP = /^\/(login|signup|invite)(\/|$)/;
const MAX_PAGES = 400;

const pages = new Map(); // key (path+search) → output file, relative to outDir
const assets = new Map(); // url path → output file
const queue = ["/"];

const slug = (s) => s.replace(/^\?/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
function pageFile(key) {
  const u = new URL(key, base);
  const dir = u.pathname.replace(/^\/+|\/+$/g, "");
  return path.posix.join(dir, u.search ? `q-${slug(u.search)}` : "", "index.html");
}
const rel = (fromFile, toFile) => path.posix.relative(path.posix.dirname(fromFile), toFile) || path.posix.basename(toFile);

const EXT = { "text/plain": ".txt", "text/csv": ".csv", "application/pdf": ".pdf", "text/markdown": ".md", "text/html": ".html", "application/json": ".json" };

async function get(p) {
  const res = await fetch(new URL(p, base), { headers, redirect: "manual" });
  return res;
}

async function write(file, data) {
  const full = path.join(outDir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
}

/** Downloads a static asset (CSS, fonts, icons) or an API file once, returning its output path. */
async function asset(p) {
  const clean = p.split("#")[0];
  if (assets.has(clean)) return assets.get(clean);
  const res = await get(clean);
  if (!res.ok) { assets.set(clean, null); return null; }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  let file = decodeURIComponent(new URL(clean, base).pathname).replace(/^\/+/, "");
  if (clean.startsWith("/api/")) file += EXT[type] ?? ".bin";
  assets.set(clean, file);
  if (type === "text/css") {
    let css = await res.text();
    const refs = [...css.matchAll(/url\((['"]?)(\/[^)'"]+)\1\)/g)].map((m) => m[2]);
    for (const r of new Set(refs)) {
      const f = await asset(r);
      if (f) css = css.split(r).join(rel(file, f));
    }
    await write(file, css);
  } else {
    await write(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

const BANNER = `<div class="preview-banner">Read-only preview with fictional demo data. Nothing you click is saved.</div>`;
const TAIL = `<div id="preview-toast" role="status" aria-live="polite"></div>
<style>
.preview-banner{background:#0f2f6b;color:#fff;font:500 13px/1.4 system-ui,sans-serif;text-align:center;padding:8px 16px}
#preview-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0f2f6b;color:#fff;font:500 14px system-ui,sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2);opacity:0;pointer-events:none;transition:opacity .2s}
#preview-toast.show{opacity:1}
</style>
<script>
(function(){var t=document.getElementById("preview-toast"),h;function say(){t.textContent="This is a read-only preview. Changes aren't saved.";t.classList.add("show");clearTimeout(h);h=setTimeout(function(){t.classList.remove("show")},2200)}
document.addEventListener("submit",function(e){e.preventDefault();say()},true);
document.addEventListener("click",function(e){var b=e.target.closest("button");if(b){e.preventDefault();say()}},true);})();
</script>`;

async function crawlPage(key) {
  const file = pageFile(key);
  const res = await get(key);
  if (res.status >= 300 && res.status < 400) {
    const loc = new URL(res.headers.get("location"), base);
    const target = loc.pathname + loc.search;
    if (!SKIP.test(loc.pathname)) enqueue(target);
    const href = SKIP.test(loc.pathname) ? "index.html" : rel(file, pageFile(target));
    await write(file, `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${href}"><a href="${href}">Continue</a>`);
    return;
  }
  if (!res.ok) { console.warn(`skip ${key}: ${res.status}`); return; }
  let html = await res.text();

  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*\b(as="script"|rel="modulepreload")[^>]*>/gi, "");

  const refs = new Set([...html.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]));
  const map = new Map();
  for (const r of refs) {
    const raw = r.replace(/&amp;/g, "&");
    const u = new URL(raw, base);
    const hash = u.hash;
    if (u.pathname.startsWith("/_next/") || /\.(ico|png|svg|webp|jpg|css|woff2?)$/.test(u.pathname) || u.pathname.startsWith("/api/")) {
      const f = await asset(u.pathname + u.search);
      map.set(r, f ? rel(file, f) : "#");
    } else if (SKIP.test(u.pathname)) {
      map.set(r, rel(file, "index.html"));
    } else {
      const target = u.pathname + u.search;
      enqueue(target);
      map.set(r, rel(file, pageFile(target)) + hash);
    }
  }
  html = html.replace(/\b(href|src)="(\/[^"]*)"/g, (m, attr, r) => `${attr}="${map.get(r) ?? r}"`);
  html = html.replace(/<body([^>]*)>/i, `<body$1>${BANNER}`).replace(/<\/body>/i, `${TAIL}</body>`);
  await write(file, html);
}

function enqueue(key) {
  const k = key.replace(/\/+$/, "") || "/";
  if (pages.has(k) || pages.size >= MAX_PAGES) return;
  pages.set(k, pageFile(k));
  queue.push(k);
}

await fs.rm(outDir, { recursive: true, force: true });
pages.set("/", pageFile("/"));
while (queue.length) await crawlPage(queue.shift());
await write(".nojekyll", "");
await write("robots.txt", "User-agent: *\nDisallow: /\n");
console.log(`Wrote ${pages.size} pages and ${[...assets.values()].filter(Boolean).length} files to ${outDir}`);
