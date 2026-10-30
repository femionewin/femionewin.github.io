// Builds the link-protected portfolio.
//
// Reads the plaintext site from _source/ (never committed), encrypts it into
// vault.bin with AES-256-GCM, and writes locked shell pages that decrypt it in
// the browser using the key carried in the shared link (#k=...). The URL
// fragment is never sent to the server, so GitHub only ever sees ciphertext.
//
//   node tools/build-vault.mjs            build with the existing key
//   node tools/build-vault.mjs --rotate   new key: every previous link stops working

import { randomBytes, createCipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "_source");
const keyFile = join(root, ".site-key");
const siteUrl = "https://femionewin.github.io/";

if (!existsSync(source)) {
  console.error("Missing _source/ folder (plaintext site).");
  process.exit(1);
}

let key;
if (!existsSync(keyFile) || process.argv.includes("--rotate")) {
  key = randomBytes(32);
  writeFileSync(keyFile, key.toString("base64url") + "\n");
  console.log("New key generated in .site-key");
} else {
  key = Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64url");
  if (key.length !== 32) throw new Error(".site-key must hold a 32-byte base64url key");
}

const read = (path) => readFileSync(join(source, path), "utf8");

function extractPage(file) {
  const html = read(file);
  const body = html.match(/<body([^>]*)>([\s\S]*)<\/body>/);
  const title = html.match(/<title>([\s\S]*?)<\/title>/);
  const attrs = {};
  for (const [, name, value] of body[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[name] = value;
  return { title: title ? title[1] : "", attrs, html: body[2] };
}

const binary = (path, type) => ({ type, data: readFileSync(join(source, path)).toString("base64") });

const bundle = {
  pages: {
    home: extractPage("index.html"),
    links: extractPage("links.html"),
    404: extractPage("404.html"),
  },
  css: read("assets/style.css"),
  js: read("assets/script.js"),
  sprite: read("assets/icons.svg"),
  assets: {
    "/assets/profile.jpg": binary("assets/profile.jpg", "image/jpeg"),
    "/assets/cv/femi-onewin-cv-fr.pdf": binary("assets/cv/femi-onewin-cv-fr.pdf", "application/pdf"),
    "/assets/cv/femi-onewin-cv-en.pdf": binary("assets/cv/femi-onewin-cv-en.pdf", "application/pdf"),
  },
};

const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(JSON.stringify(bundle), "utf8"), cipher.final(), cipher.getAuthTag()]);
writeFileSync(join(root, "vault.bin"), Buffer.concat([iv, ciphertext]));

const shell = (page) => `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
  <meta name="referrer" content="no-referrer">
  <meta name="theme-color" content="#0a0c0b">
  <title>Portfolio privé · Private portfolio</title>
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&amp;family=Geist+Mono:wght@400;500&amp;family=Instrument+Serif:ital@0;1&amp;display=swap">
  <style id="lock-style">
    html, body { margin: 0; min-height: 100%; background: #0a0c0b; color: #ecebe4; }
    body { display: grid; min-height: 100vh; place-items: center; padding: 1rem; box-sizing: border-box; font-family: "Geist", system-ui, sans-serif; }
    .lock { max-width: 30rem; text-align: center; }
    .lock-icon { display: inline-grid; place-items: center; width: 3.5rem; height: 3.5rem; margin-bottom: 1.5rem; border: 1px solid rgba(236,235,228,.2); border-radius: 50%; color: #c9f26b; font-size: 1.4rem; }
    .lock h1 { margin: 0 0 .75rem; font-size: clamp(1.6rem, 1.2rem + 2vw, 2.4rem); font-weight: 500; letter-spacing: -.04em; }
    .lock h1 em { color: #c9f26b; font-family: "Instrument Serif", Georgia, serif; font-weight: 400; }
    .lock p { margin: 0 0 .5rem; color: #9a9f97; line-height: 1.6; }
    .lock .en { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid rgba(236,235,228,.1); }
    .lock[data-state="loading"] .msg { display: none; }
    .lock[data-state="locked"] .loading { display: none; }
    .loading { color: #9a9f97; font-family: "Geist Mono", monospace; font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; }
  </style>
</head>
<body data-shell="${page}">
  <main class="lock" data-state="loading">
    <div class="lock-icon" aria-hidden="true">🔒</div>
    <p class="loading">Déchiffrement… · Decrypting…</p>
    <div class="msg">
      <h1>Portfolio <em>privé.</em></h1>
      <p>Ce site n’est accessible qu’avec un lien personnel.</p>
      <p class="en">Private portfolio — this site is only available through a personal link.</p>
    </div>
  </main>
  <noscript><style>.loading{display:none}.msg{display:block!important}</style></noscript>
  <script src="/shell.js"></script>
</body>
</html>
`;

writeFileSync(join(root, "index.html"), shell("home"));
writeFileSync(join(root, "links.html"), shell("links"));
writeFileSync(join(root, "404.html"), shell("404"));

writeFileSync(join(root, "shell.js"), `// Decrypts vault.bin with the key from the shared link (#k=...) and renders the page.
(async () => {
  const lock = document.querySelector(".lock");
  const showLocked = () => lock.setAttribute("data-state", "locked");
  const STORE = "portfolio-key";
  window.addEventListener("hashchange", () => { if (/[#&]k=/.test(location.hash)) location.reload(); });

  let k =new URLSearchParams(location.hash.slice(1)).get("k");
  try {
    if (k) {
      sessionStorage.setItem(STORE, k);
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      k = sessionStorage.getItem(STORE);
    }
  } catch { /* storage unavailable: the key only lives for this page view */ }
  if (!k || !window.crypto?.subtle) return showLocked();

  let bundle;
  try {
    const raw = Uint8Array.from(atob(k.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const response = await fetch("/vault.bin", { cache: "no-cache" });
    const data = new Uint8Array(await response.arrayBuffer());
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, key, data.slice(12));
    bundle = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    try { sessionStorage.removeItem(STORE); } catch {}
    return showLocked();
  }

  const urls = {};
  for (const [path, asset] of Object.entries(bundle.assets)) {
    const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0));
    urls[path] = URL.createObjectURL(new Blob([bytes], { type: asset.type }));
  }

  const page = bundle.pages[document.body.dataset.shell] || bundle.pages["404"];
  const html = page.html
    .replaceAll("/assets/icons.svg#", "#")
    .replaceAll("/assets/profile.jpg", urls["/assets/profile.jpg"]);

  document.title = page.title.replace(/&amp;/g, "&");
  document.documentElement.classList.add("js");
  document.getElementById("lock-style")?.remove();
  const style = document.createElement("style");
  style.textContent = bundle.css;
  document.head.appendChild(style);

  document.body.removeAttribute("data-shell");
  for (const [name, value] of Object.entries(page.attrs)) document.body.setAttribute(name, value);
  document.body.innerHTML = bundle.sprite.replace("<svg ", '<svg style="display:none" aria-hidden="true" ') + html;

  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="/assets/"]');
    const url = link && urls[link.getAttribute("href")];
    if (!url) return;
    event.preventDefault();
    window.open(url, "_blank");
  });

  const script = document.createElement("script");
  script.textContent = bundle.js;
  document.body.appendChild(script);
})();
`);

console.log(`vault.bin: ${(ciphertext.length / 1024).toFixed(0)} KB encrypted`);
console.log(`\nShare link:\n${siteUrl}#k=${key.toString("base64url")}\n`);
