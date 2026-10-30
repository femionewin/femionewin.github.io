// Decrypts vault.bin with the key from the shared link (#k=...) and renders the page.
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
