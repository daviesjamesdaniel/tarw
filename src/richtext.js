// Shared by the main window (signature editor) and the compose window.

export const SIGNATURE_MARKER = "data-tarw-signature";

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
  // The "-- " delimiter belongs to the plain-text version only; the HTML
  // version shows just a gap above the signature.
  scratch.querySelectorAll(`[${SIGNATURE_MARKER}]`).forEach((el) => el.prepend("\n-- \n"));
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
  IMG: ["src", "alt", "width", "height", "border"],
  TD: ["colspan", "rowspan"],
  TH: ["colspan", "rowspan"],
};
const ALLOWED_STYLE_PROPS = [
  "color",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-decoration",
];
export const FONT_SIZE_PX = { 1: 10, 2: 13, 3: 16, 4: 18, 5: 24, 6: 32, 7: 48 };

// Style values are copied verbatim into the stored signature, so refuse
// anything that could pull in a resource or break out of the attribute.
function safeStyleValue(value) {
  return value.length <= 120 && !/url\s*\(|expression|@import|[<>\\]|javascript:/i.test(value);
}

// Old-school <font color face size> (Outlook/Word paste, execCommand without
// styleWithCSS) becomes a span with equivalent inline style.
function fontToSpan(font) {
  const span = font.ownerDocument.createElement("span");
  const color = font.getAttribute("color");
  const face = font.getAttribute("face");
  const size = FONT_SIZE_PX[font.getAttribute("size")];
  if (color) span.style.color = color;
  if (face) span.style.fontFamily = face;
  if (size) span.style.fontSize = `${size}px`;
  span.append(...font.childNodes);
  font.replaceWith(span);
  return span;
}

function safeHref(value) {
  return /^(https?:|mailto:|tel:)/i.test(value.trim());
}

function safeImgSrc(value) {
  return /^(https?:|cid:|data:image\/(png|jpe?g|gif|webp);)/i.test(value.trim());
}

function sanitizeNode(node) {
  for (let child of [...node.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (DROP_WITH_CONTENT.has(child.tagName.toUpperCase())) {
        child.remove();
        continue;
      }
      if (child.tagName === "FONT") child = fontToSpan(child);
      sanitizeNode(child);
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      const allowed = ALLOWED_ATTRS[child.tagName] ?? [];
      const keptStyle = [];
      for (const prop of ALLOWED_STYLE_PROPS) {
        const v = child.style.getPropertyValue(prop);
        if (v && safeStyleValue(v)) keptStyle.push(`${prop}:${v}`);
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
  return askForText({ title: "Insert link", placeholder: "https://example.com", submitLabel: "Insert", initial });
}

// WebKitGTK's window.prompt()/confirm() don't reliably work in this app, so
// this is the one real text-input dialog, reused for both links and custom
// fonts rather than duplicating the overlay markup/wiring per caller.
export function askForText({ title, placeholder = "", submitLabel = "OK", initial = "" }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "compose-overlay";
    overlay.innerHTML = `<form class="compose-panel create-mailbox-panel">
      <div class="compose-header"><span>${escapeHtml(title)}</span>
        <button type="button" class="compose-close" aria-label="Close">&times;</button></div>
      <div class="link-dialog-body"><input type="text" class="link-dialog-input" placeholder="${escapeHtml(placeholder)}" spellcheck="false" /></div>
      <div class="compose-footer">
        <button type="button" class="compose-secondary link-dialog-cancel">Cancel</button>
        <button type="submit" class="compose-send">${escapeHtml(submitLabel)}</button>
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

// Images are stored inline as data: URIs (rewritten to CID parts on send), so
// keep them modest: anything wider than MAX_IMAGE_WIDTH is scaled down, and
// the result has to fit under MAX_IMAGE_BYTES.
const MAX_IMAGE_WIDTH = 600;
const MAX_IMAGE_BYTES = 300 * 1024;
const MIN_IMAGE_WIDTH = 120;
// Source files above this are rejected before decode/canvas work: a huge
// source (e.g. a full-res camera photo) can otherwise hang the WebKitGTK
// main thread for a long time with no feedback, which looks like a silent
// failure rather than an error.
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

const approxBytes = (dataUri) => Math.floor(((dataUri.length - dataUri.indexOf(",") - 1) * 3) / 4);

// Returns { dataUri, width } for an image given as base64. Small images pass
// through untouched (keeping e.g. GIF animation); others are re-drawn scaled.
export async function prepareImage(bytesBase64, mimeType) {
  const sourceBytes = Math.floor((bytesBase64.length * 3) / 4);
  if (sourceBytes > MAX_SOURCE_BYTES) {
    throw new Error(`That image is too large (over ${Math.round(MAX_SOURCE_BYTES / (1024 * 1024))}MB) - try a smaller file`);
  }
  const original = `data:${mimeType};base64,${bytesBase64}`;
  const img = new Image();
  img.src = original;
  try {
    await img.decode();
  } catch {
    throw new Error("That file isn't an image the editor can read");
  }
  if (img.naturalWidth <= MAX_IMAGE_WIDTH && approxBytes(original) <= MAX_IMAGE_BYTES) {
    return { dataUri: original, width: img.naturalWidth };
  }
  const outType = mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
  let width = Math.min(img.naturalWidth, MAX_IMAGE_WIDTH);
  for (;;) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.max(1, Math.round((img.naturalHeight * width) / img.naturalWidth));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUri = canvas.toDataURL(outType, 0.85);
    if (approxBytes(dataUri) <= MAX_IMAGE_BYTES) return { dataUri, width };
    if (width <= MIN_IMAGE_WIDTH) {
      throw new Error("That image is too large to use here, even scaled down");
    }
    width = Math.round(width * 0.8);
  }
}

// Picking a file (native dialog) and scaling it down can take a while, long
// enough that WebKitGTK loses the editor's caret position in the meantime -
// capture it before that gap and pass it to insertImageInEditor so the image
// still lands where the user clicked instead of silently going nowhere.
export function captureEditorRange(iframe) {
  const sel = iframe.contentWindow?.getSelection();
  return sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
}

export function insertImageInEditor(iframe, { dataUri, width }, savedRange) {
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  win.focus();
  const sel = win.getSelection();
  if (savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  } else if (!sel || sel.rangeCount === 0) {
    // Nothing was ever selected/clicked in the body (e.g. a fresh compose
    // window) - focus() alone doesn't reliably create a caret in WebKitGTK,
    // and execCommand with no selection silently does nothing. Fall back to
    // a collapsed range at the end of the body.
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const shown = Math.min(width, 200);
  iframe.contentDocument.execCommand(
    "insertHTML",
    false,
    `<img src="${dataUri}" alt="" width="${shown}" border="0">`,
  );
}

// Like the link bar: while an image is selected in the editor, show a bar
// with size presets, alt text and Remove. The selection is polled for the
// same reason (no listeners on sandboxed editor documents).
export function attachImageBar(iframe) {
  const bar = document.createElement("div");
  bar.className = "link-bar image-bar";
  bar.hidden = true;
  bar.innerHTML = `<span>Image</span>
    <button type="button" class="link-bar-button" data-w="100">Small</button>
    <button type="button" class="link-bar-button" data-w="200">Medium</button>
    <button type="button" class="link-bar-button" data-w="300">Large</button>
    <button type="button" class="link-bar-button" data-w="0">Original</button>
    <input type="text" class="image-bar-alt" placeholder="Alt text" spellcheck="false" />
    <button type="button" class="link-bar-button" data-act="link">Link</button>
    <button type="button" class="link-bar-button" data-act="remove">Remove</button>`;
  iframe.before(bar);
  const altEl = bar.querySelector(".image-bar-alt");
  let current = null;

  // WebKit can represent a clicked image a few ways depending on how it was
  // clicked, so accept any of them: the image as the selection's anchor, a
  // range that spans exactly one image, or a non-text selection containing one.
  const selectedImage = () => {
    const sel = iframe.contentWindow?.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    if (sel.anchorNode?.nodeName === "IMG") return sel.anchorNode;
    const range = sel.getRangeAt(0);
    if (range.startContainer === range.endContainer && range.endOffset - range.startOffset === 1) {
      const node = range.startContainer.childNodes[range.startOffset];
      if (node?.nodeName === "IMG") return node;
    }
    if (!sel.isCollapsed && sel.toString().trim() === "") {
      const inside = [...iframe.contentDocument.images].filter((img) => sel.containsNode(img, false));
      if (inside.length === 1) return inside[0];
    }
    return null;
  };

  setInterval(() => {
    if (!iframe.isConnected || iframe.offsetParent === null) {
      bar.hidden = true;
      current = null;
      return;
    }
    const img = selectedImage();
    if (img === current) return;
    current = img;
    bar.hidden = !img;
    if (img) altEl.value = img.getAttribute("alt") ?? "";
  }, 250);

  bar.addEventListener("click", async (e) => {
    const button = e.target.closest("button");
    if (!button || !current) return;
    if (button.dataset.act === "link") {
      const img = current;
      const existing = img.closest("a");
      const raw = await askForLink(existing?.getAttribute("href") ?? "");
      if (!raw) return;
      const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
      if (existing) {
        existing.setAttribute("href", url);
      } else {
        const a = img.ownerDocument.createElement("a");
        a.setAttribute("href", url);
        img.before(a);
        a.appendChild(img);
      }
      img.setAttribute("border", "0");
    } else if (button.dataset.act === "remove") {
      current.remove();
      current = null;
      bar.hidden = true;
    } else if (button.dataset.w !== undefined) {
      const w = Number(button.dataset.w);
      current.setAttribute("width", String(w === 0 ? current.naturalWidth : Math.min(w, current.naturalWidth)));
      current.removeAttribute("height");
    }
  });

  altEl.addEventListener("input", () => {
    if (current) current.setAttribute("alt", altEl.value);
  });
}

// Fonts offered in the compose and signature toolbars. Recipients only have
// what is installed on their own machine, so these are the widely available
// ones, each with a generic fallback.
const FONT_GROUPS = [
  ["Sans-serif", [["Arial", "Arial, sans-serif"], ["Helvetica", "Helvetica, Arial, sans-serif"], ["Verdana", "Verdana, sans-serif"], ["Tahoma", "Tahoma, sans-serif"], ["Trebuchet MS", "'Trebuchet MS', sans-serif"], ["Calibri", "Calibri, Arial, sans-serif"]]],
  ["Serif", [["Georgia", "Georgia, serif"], ["Times New Roman", "'Times New Roman', Times, serif"], ["Palatino", "'Palatino Linotype', Palatino, serif"], ["Garamond", "Garamond, serif"]]],
  ["Monospace", [["Courier New", "'Courier New', monospace"], ["Lucida Console", "'Lucida Console', Monaco, monospace"]]],
  ["Other", [["Comic Sans MS", "'Comic Sans MS', cursive, sans-serif"]]],
];

// Fonts actually installed on this machine (via fontconfig - see
// list_system_fonts in Rust). Each window populates this once at startup by
// calling setSystemFonts(await invoke("list_system_fonts")); module state
// doesn't cross windows, so main.js and compose.js each do this themselves.
let systemFonts = [];

export function setSystemFonts(names) {
  systemFonts = [...names].sort((a, b) => a.localeCompare(b));
}

export function fillFontSelect(select) {
  // The editor body doesn't start in any of the named fonts below (it uses
  // the system UI font), so without this the dropdown opens with nothing
  // selected at all until the user actually picks a font.
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Default";
  select.appendChild(defaultOption);
  for (const [label, fonts] of FONT_GROUPS) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const [name, stack] of fonts) {
      const option = document.createElement("option");
      option.value = stack;
      option.textContent = name;
      group.appendChild(option);
    }
    select.appendChild(group);
  }
  if (systemFonts.length > 0) {
    const group = document.createElement("optgroup");
    group.label = "Monospace (installed)";
    for (const name of systemFonts) {
      const option = document.createElement("option");
      option.value = /[,'"]/.test(name) ? name : `'${name}', sans-serif`;
      option.textContent = name;
      group.appendChild(option);
    }
    select.appendChild(group);
  }
}

// Keeps the font and size dropdowns showing what is under the cursor or
// selection. Polled for the same reason as the link/image bars. Skipped while
// one of the dropdowns has focus so it can't fight the user's own choice.
export function attachFontSync(iframe, familySelect, sizeSelect) {
  const firstFamily = (stack) => stack.split(",")[0].trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  const familyByName = new Map(
    [...familySelect.options].filter((o) => o.value).map((o) => [firstFamily(o.value), o.value]),
  );
  setInterval(() => {
    if (!iframe.isConnected || iframe.offsetParent === null) return;
    if (document.activeElement === familySelect || document.activeElement === sizeSelect) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    try {
      familySelect.value = familyByName.get(firstFamily(doc.queryCommandValue("fontName") || "")) ?? "";
      const size = doc.queryCommandValue("fontSize");
      sizeSelect.value = [...sizeSelect.options].some((o) => o.value === size) ? size : "";
    } catch {
      // queryCommandValue can throw before the editor document is ready.
    }
  }, 250);
}
