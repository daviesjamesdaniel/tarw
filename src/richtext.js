// Shared by the main window (signature editor) and the compose window.

export function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export function htmlToPlainText(html) {
  const scratch = document.createElement("div");
  scratch.innerHTML = html;
  scratch.querySelectorAll("script, style").forEach((el) => el.remove());
  scratch.querySelectorAll("img").forEach((img) => {
    const alt = img.getAttribute("alt")?.trim();
    if (alt) img.replaceWith(`[Image: ${alt}]`);
    else img.remove();
  });
  scratch.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href").trim();
    const text = a.textContent.trim();
    const bare = href.replace(/^(mailto:|tel:)/i, "");
    if (!href || text === href || text === bare) return;
    a.append(` (${bare})`);
  });
  scratch.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  scratch.querySelectorAll("p, div, tr, li, h1, h2, h3, h4, h5, h6").forEach((el) => {
    el.append("\n");
  });
  return scratch.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

const DROP_WITH_CONTENT = new Set([
  "SCRIPT", "STYLE", "HEAD", "META", "LINK", "TITLE", "IFRAME", "OBJECT",
  "EMBED", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "SVG", "MATH", "NOSCRIPT",
]);
const ALLOWED_TAGS = new Set([
  "A", "B", "STRONG", "I", "EM", "U", "BR", "P", "DIV", "SPAN", "UL", "OL", "LI",
  "BLOCKQUOTE", "IMG", "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "THEAD",
  "TBODY", "TR", "TD", "TH", "HR",
]);
const ALLOWED_ATTRS = {
  A: ["href"],
  IMG: ["src", "alt", "width", "height"],
  TD: ["colspan", "rowspan"],
  TH: ["colspan", "rowspan"],
};
const ALLOWED_STYLE_PROPS = ["font-weight", "font-style", "text-decoration"];

function safeHref(value) {
  return /^(https?:|mailto:|tel:)/i.test(value.trim());
}

function safeImgSrc(value) {
  return /^(https?:|cid:|data:image\/(png|jpe?g|gif|webp);)/i.test(value.trim());
}

function sanitizeNode(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (DROP_WITH_CONTENT.has(child.tagName.toUpperCase())) {
        child.remove();
        continue;
      }
      sanitizeNode(child);
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      const allowed = ALLOWED_ATTRS[child.tagName] ?? [];
      const keptStyle = [];
      for (const prop of ALLOWED_STYLE_PROPS) {
        const v = child.style.getPropertyValue(prop);
        if (v) keptStyle.push(`${prop}:${v}`);
      }
      for (const attr of [...child.attributes]) {
        if (!allowed.includes(attr.name)) child.removeAttribute(attr.name);
      }
      if (keptStyle.length > 0) child.setAttribute("style", keptStyle.join(";"));
      if (child.tagName === "A" && !safeHref(child.getAttribute("href") ?? "")) {
        child.replaceWith(...child.childNodes);
      } else if (child.tagName === "IMG" && !safeImgSrc(child.getAttribute("src") ?? "")) {
        child.remove();
      }
    }
  }
}

// DOMParser builds an inert document, so nothing in the pasted markup can
// execute or load resources while we clean it.
export function sanitizeHtml(html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  sanitizeNode(parsed.body);
  return parsed.body.innerHTML;
}

// In-app replacement for window.prompt(), which is unreliable in WebKitGTK.
// Resolves with the entered URL, or null if cancelled.
export function askForLink(initial = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "compose-overlay";
    overlay.innerHTML = `<form class="compose-panel create-mailbox-panel">
      <div class="compose-header"><span>Insert link</span>
        <button type="button" class="compose-close" aria-label="Close">&times;</button></div>
      <div class="link-dialog-body"><input type="text" class="link-dialog-input" placeholder="https://example.com" spellcheck="false" /></div>
      <div class="compose-footer">
        <button type="button" class="compose-secondary link-dialog-cancel">Cancel</button>
        <button type="submit" class="compose-send">Insert</button>
      </div></form>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("input");
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      finish(v || null);
    });
    overlay.querySelector(".compose-close").addEventListener("click", () => finish(null));
    overlay.querySelector(".link-dialog-cancel").addEventListener("click", () => finish(null));
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(null);
      }
    });
    input.value = initial;
    input.focus();
    input.select();
  });
}

// Runs the link insert against an iframe editor: wraps a selection, or
// inserts the URL itself as the link text when nothing is selected.
export async function insertLinkInEditor(iframe) {
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  win.focus();
  const hasSelection = (win.getSelection()?.toString() ?? "").trim().length > 0;
  const range = hasSelection ? win.getSelection().getRangeAt(0).cloneRange() : null;
  const raw = await askForLink();
  if (!raw) return;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  win.focus();
  if (range) {
    const sel = win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    doc.execCommand("createLink", false, url);
  } else {
    const safe = escapeHtml(url);
    doc.execCommand("insertHTML", false, `<a href="${safe}">${safe}</a>`);
  }
}

// The editor iframes are sandboxed without allow-scripts, and WebKit won't
// run event listeners on such a document even when added from the parent.
// So instead of listening for clicks, poll the caret from here (direct DOM
// access still works) and show a small bar above the editor while it sits
// inside a link.
export function attachLinkBar(iframe, openUrl) {
  const bar = document.createElement("div");
  bar.className = "link-bar";
  bar.hidden = true;
  bar.innerHTML = `<span class="link-bar-url"></span>
    <button type="button" class="link-bar-button" data-act="open">Open</button>
    <button type="button" class="link-bar-button" data-act="edit">Edit</button>
    <button type="button" class="link-bar-button" data-act="remove">Remove</button>`;
  iframe.before(bar);
  const urlEl = bar.querySelector(".link-bar-url");
  let current = null;

  const anchorAtCaret = () => {
    const sel = iframe.contentWindow?.getSelection();
    const node = sel?.anchorNode;
    if (!node) return null;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return el?.closest("a[href]") ?? null;
  };

  setInterval(() => {
    if (!iframe.isConnected || iframe.offsetParent === null) {
      bar.hidden = true;
      current = null;
      return;
    }
    const a = anchorAtCaret();
    if (a === current) return;
    current = a;
    bar.hidden = !a;
    if (a) urlEl.textContent = a.getAttribute("href");
  }, 250);

  bar.addEventListener("click", async (e) => {
    const act = e.target.closest("button")?.dataset.act;
    if (!act || !current) return;
    const a = current;
    if (act === "open") {
      const href = a.getAttribute("href").trim();
      const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
      try {
        await openUrl(url);
      } catch (err) {
        urlEl.textContent = `Couldn't open ${url}: ${err}`;
      }
    } else if (act === "remove") {
      a.replaceWith(...a.childNodes);
      current = null;
      bar.hidden = true;
    } else if (act === "edit") {
      const raw = await askForLink(a.getAttribute("href"));
      if (!raw) return;
      a.setAttribute("href", /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
      urlEl.textContent = a.getAttribute("href");
    }
  });
}
