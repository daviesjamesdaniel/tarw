import { escapeHtml, htmlToPlainText, attachLinkBar, insertLinkInEditor } from "./richtext.js";

const { invoke } = window.__TAURI__.core;
const { emit } = window.__TAURI__.event;
const currentWindow = window.__TAURI__.window.getCurrentWindow();

const composeFormEl = document.getElementById("compose-form");
const composeAccountFieldEl = document.getElementById("compose-account-field");
const composeAccountEl = document.getElementById("compose-account");
const composeToEl = document.getElementById("compose-to");
const composeCcEl = document.getElementById("compose-cc");
const composeBccEl = document.getElementById("compose-bcc");
const composeCcFieldEl = document.getElementById("compose-cc-field");
const composeBccFieldEl = document.getElementById("compose-bcc-field");
const composeShowCcEl = document.getElementById("compose-show-cc");
const composeShowBccEl = document.getElementById("compose-show-bcc");
const composeSubjectEl = document.getElementById("compose-subject");
const composeBodyEl = document.getElementById("compose-body");
const composeToolbarEl = document.getElementById("compose-toolbar");
const composeSignatureToggleEl = document.getElementById("compose-signature-toggle");
const composeSignatureLabelEl = document.getElementById("compose-signature-label");
const composeSignatureSelectEl = document.getElementById("compose-signature-select");
const composeLinkButtonEl = document.getElementById("compose-link-button");
const composeTextColorEl = document.getElementById("compose-text-color");
const composeHighlightColorEl = document.getElementById("compose-highlight-color");
const composeAttachmentsBarEl = document.getElementById("compose-attachments-bar");
const composeErrorEl = document.getElementById("compose-error");
const composeSendEl = document.getElementById("compose-send");
const composeSaveDraftEl = document.getElementById("compose-save-draft");

let editingDraft = null;
let composeInReplyTo = "";
let composeReferences = "";
let composeForwardAttachments = null;
// Freshly-picked/dropped local files staged for this message, distinct
// from composeForwardAttachments (attachments carried over from an
// original message being forwarded, fetched live from the IMAP server
// rather than the local filesystem). Both render into the same bar and
// both end up in the same outgoing attachment list, just via different
// Tauri commands - see gatherComposeFields()/resolve_outgoing_attachments.
let composeLocalAttachments = [];
const recipientAddressBook = new Map();

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function openAttachment(account, hash, index) {
  try {
    await invoke("open_attachment", { account, hash, index });
  } catch (err) {
    console.error("open_attachment failed", err);
    composeErrorEl.textContent = `Couldn't open attachment: ${err}`;
  }
}

function rankedAddressSuggestions(query, limit = 6) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const candidates = [...recipientAddressBook.values()].filter(
    (c) => c.address.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
  );
  candidates.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
  return candidates.slice(0, limit);
}

function currentRecipientToken(inputEl) {
  const value = inputEl.value;
  const caret = inputEl.selectionStart ?? value.length;
  const uptoCaret = value.slice(0, caret);
  const lastComma = uptoCaret.lastIndexOf(",");
  return { start: lastComma + 1, text: uptoCaret.slice(lastComma + 1).trim() };
}

function setupRecipientAutocomplete(inputEl, suggestionsEl) {
  let activeIndex = -1;
  let currentMatches = [];

  function hide() {
    suggestionsEl.hidden = true;
    suggestionsEl.innerHTML = "";
    activeIndex = -1;
    currentMatches = [];
  }

  function updateActiveHighlight() {
    suggestionsEl.querySelectorAll(".recipient-suggestion").forEach((btn, i) => {
      btn.classList.toggle("active", i === activeIndex);
    });
  }

  function applySuggestion(match) {
    const { start, text } = currentRecipientToken(inputEl);
    const before = inputEl.value.slice(0, start);
    const after = inputEl.value.slice(start + text.length);
    const formatted = match.name ? `${match.name} <${match.address}>` : match.address;
    const prefix = before && !/[\s,]$/.test(before) ? `${before} ` : before;
    inputEl.value = `${prefix}${formatted}, ${after.trimStart()}`;
    hide();
    inputEl.focus();
  }

  function render() {
    const { text } = currentRecipientToken(inputEl);
    currentMatches = rankedAddressSuggestions(text);
    if (currentMatches.length === 0) {
      hide();
      return;
    }
    activeIndex = 0;
    suggestionsEl.innerHTML = currentMatches
      .map(
        (m, i) =>
          `<button type="button" class="recipient-suggestion${i === activeIndex ? " active" : ""}" data-index="${i}">` +
          `<span>${escapeHtml(m.name || m.address)}</span>` +
          (m.name ? `<span class="recipient-suggestion-address">${escapeHtml(m.address)}</span>` : "") +
          `</button>`,
      )
      .join("");
    suggestionsEl.hidden = false;
    suggestionsEl.querySelectorAll(".recipient-suggestion").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        applySuggestion(currentMatches[Number(btn.dataset.index)]);
      });
    });
  }

  inputEl.addEventListener("input", render);
  inputEl.addEventListener("keydown", (e) => {
    if (suggestionsEl.hidden || currentMatches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentMatches.length;
      updateActiveHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
      updateActiveHighlight();
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (activeIndex >= 0) {
        e.preventDefault();
        applySuggestion(currentMatches[activeIndex]);
      }
    } else if (e.key === "Escape") {
      hide();
    }
  });
  inputEl.addEventListener("blur", () => setTimeout(hide, 150));
}

setupRecipientAutocomplete(composeToEl, document.getElementById("compose-to-suggestions"));
setupRecipientAutocomplete(composeCcEl, document.getElementById("compose-cc-suggestions"));
setupRecipientAutocomplete(composeBccEl, document.getElementById("compose-bcc-suggestions"));

function initComposeBodyDoc() {
  const doc = composeBodyEl.contentDocument;
  doc.open();
  doc.write(
    "<!doctype html><html><head><style>" +
      'html,body{margin:0;padding:1rem;background:Canvas;color:CanvasText;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:0.88rem;}' +
      "blockquote{margin:0 0 0 0.5em;padding-left:1em;border-left:2px solid rgba(128,128,128,0.4);}" +
      "img{max-width:100%;}" +
      "</style></head><body contenteditable=\"true\"></body></html>",
  );
  doc.close();
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape") currentWindow.close();
  });
}
initComposeBodyDoc();
attachLinkBar(composeBodyEl, (url) => invoke("open_external_url", { url }));

composeToolbarEl.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-cmd]");
  if (!button) return;
  composeBodyEl.contentWindow.focus();
  composeBodyEl.contentDocument.execCommand(button.dataset.cmd, false, null);
});

composeLinkButtonEl.addEventListener("click", () => insertLinkInEditor(composeBodyEl));

composeTextColorEl.addEventListener("input", (e) => {
  composeBodyEl.contentWindow.focus();
  composeBodyEl.contentDocument.execCommand("foreColor", false, e.target.value);
});

composeHighlightColorEl.addEventListener("input", (e) => {
  composeBodyEl.contentWindow.focus();
  composeBodyEl.contentDocument.execCommand("hiliteColor", false, e.target.value);
});

function setComposeBodyHtml(html) {
  composeBodyEl.contentDocument.body.innerHTML = html;
}

function getComposeBodyHtml() {
  return composeBodyEl.contentDocument.body.innerHTML;
}

const SIGNATURE_MARKER = "data-tarw-signature";
let composeAccounts = [];
let composeIsReplyLike = false;

function accountWithSignatures(email) {
  const acct = composeAccounts.find((a) => a.email === email);
  return acct?.signatures?.length > 0 ? acct : null;
}

// Signature lives in a marker div (its value is the signature's id) so it can
// be swapped or removed again (account change, checkbox, dropdown) without
// disturbing what the user has typed. On replies/forwards it goes right after
// the first (typed-reply) paragraph, above the quoted original; on new
// messages it goes at the end.
function applyComposeSignature(email, signatureId) {
  const body = composeBodyEl.contentDocument.body;
  body.querySelectorAll(`[${SIGNATURE_MARKER}]`).forEach((el) => el.remove());
  const sig = accountWithSignatures(email)?.signatures.find((s) => s.id === signatureId);
  if (!sig) return;
  const block = composeBodyEl.contentDocument.createElement("div");
  block.setAttribute(SIGNATURE_MARKER, sig.id);
  block.innerHTML = `<br>-- <br>${sig.html}`;
  const anchor = composeIsReplyLike ? body.firstElementChild : null;
  if (anchor) anchor.after(block);
  else body.appendChild(block);
}

function fillSignatureSelect(email, selectedId) {
  const acct = accountWithSignatures(email);
  composeSignatureSelectEl.innerHTML = (acct?.signatures ?? [])
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`)
    .join("");
  const ids = (acct?.signatures ?? []).map((s) => s.id);
  composeSignatureSelectEl.value = ids.includes(selectedId) ? selectedId : (acct?.default_signature_id ?? ids[0] ?? "");
}

// The checkbox stays visible so signatures are discoverable, but is disabled
// (with an explanation) when the chosen account has none. The dropdown only
// shows when it's ticked and there is a choice to make.
function syncSignatureControl() {
  const acct = accountWithSignatures(composeAccountEl.value);
  composeSignatureToggleEl.disabled = !acct;
  if (!acct) composeSignatureToggleEl.checked = false;
  composeSignatureLabelEl.title = acct
    ? ""
    : "No signature set for this account - add one in Settings (signature icon next to the account)";
  composeSignatureLabelEl.classList.toggle("compose-signature-disabled", !acct);
  composeSignatureSelectEl.hidden = !acct || !composeSignatureToggleEl.checked || acct.signatures.length < 2;
}

function refreshComposeSignature() {
  const email = composeAccountEl.value;
  applyComposeSignature(email, composeSignatureToggleEl.checked ? composeSignatureSelectEl.value : null);
  syncSignatureControl();
}

function placeComposeCaretAtStart() {
  const doc = composeBodyEl.contentDocument;
  const win = composeBodyEl.contentWindow;
  const range = doc.createRange();
  range.setStart(doc.body, 0);
  range.collapse(true);
  const sel = win.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  win.focus();
}

function buildAttachmentChip({ filename, size, onClick, onRemove }) {
  const chip = document.createElement("div");
  chip.className = "attachment-chip";
  chip.title = onClick ? `Open ${filename}` : filename;
  chip.innerHTML = `<span class="attachment-chip-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></span>
    <span class="attachment-chip-name">${escapeHtml(filename)}</span>
    <span class="attachment-chip-size">${formatFileSize(size)}</span>
    <button class="attachment-chip-remove" type="button" title="Remove">&times;</button>`;
  if (onClick) chip.addEventListener("click", onClick);
  chip.querySelector(".attachment-chip-remove").addEventListener("click", (e) => {
    e.stopPropagation();
    onRemove();
  });
  return chip;
}

function renderComposeAttachmentsBar() {
  composeAttachmentsBarEl.innerHTML = "";
  const forwarded = composeForwardAttachments?.attachments ?? [];
  const hasAny = forwarded.length > 0 || composeLocalAttachments.length > 0;
  composeAttachmentsBarEl.hidden = !hasAny;
  if (!hasAny) return;

  const { sourceHash, sourceAccount } = composeForwardAttachments ?? {};
  for (const att of forwarded) {
    composeAttachmentsBarEl.appendChild(
      buildAttachmentChip({
        filename: att.filename,
        size: att.size,
        onClick: () => openAttachment(sourceAccount, sourceHash, att.index),
        onRemove: () => {
          composeForwardAttachments.attachments = composeForwardAttachments.attachments.filter(
            (a) => a.index !== att.index,
          );
          renderComposeAttachmentsBar();
        },
      }),
    );
  }
  for (const att of composeLocalAttachments) {
    composeAttachmentsBarEl.appendChild(
      buildAttachmentChip({
        filename: att.filename,
        size: att.size,
        onRemove: () => {
          composeLocalAttachments = composeLocalAttachments.filter((a) => a !== att);
          renderComposeAttachmentsBar();
        },
      }),
    );
  }
}

async function attachLocalFile(path) {
  try {
    const info = await invoke("read_attachment_file", { path });
    composeLocalAttachments.push(info);
    renderComposeAttachmentsBar();
  } catch (err) {
    console.error("read_attachment_file failed", err);
    composeErrorEl.textContent = `Couldn't attach file: ${err}`;
  }
}

document.getElementById("compose-attach-button").addEventListener("click", async () => {
  const selected = await window.__TAURI__.dialog.open({ multiple: true });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  for (const path of paths) {
    await attachLocalFile(path);
  }
});

currentWindow.onDragDropEvent((event) => {
  if (event.payload.type === "drop") {
    for (const path of event.payload.paths) {
      attachLocalFile(path);
    }
  }
});

function revealComposeField(fieldEl, toggleEl, inputEl) {
  fieldEl.hidden = false;
  toggleEl.hidden = true;
  inputEl.focus();
}

composeShowCcEl.addEventListener("click", () =>
  revealComposeField(composeCcFieldEl, composeShowCcEl, composeCcEl),
);
composeShowBccEl.addEventListener("click", () =>
  revealComposeField(composeBccFieldEl, composeShowBccEl, composeBccEl),
);

document.getElementById("compose-cancel").addEventListener("click", () => currentWindow.close());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") currentWindow.close();
});

// The signature marker is only for toggling it in-editor, so drafts keep it
// but the copy that goes out over SMTP doesn't carry it.
function gatherComposeFields({ forSend = false } = {}) {
  let bodyHtml = getComposeBodyHtml();
  if (forSend) bodyHtml = bodyHtml.replace(new RegExp(` ${SIGNATURE_MARKER}="[^"]*"`, "g"), "");
  return {
    account: composeAccountEl.value,
    to: composeToEl.value,
    cc: composeCcEl.value,
    bcc: composeBccEl.value,
    subject: composeSubjectEl.value,
    bodyHtml,
    bodyText: htmlToPlainText(bodyHtml),
    inReplyTo: composeInReplyTo,
    references: composeReferences,
    attachmentSourceHash: composeForwardAttachments?.sourceHash ?? "",
    attachmentIndices: composeForwardAttachments?.attachments.map((a) => a.index) ?? [],
    localAttachments: composeLocalAttachments.map((a) => ({
      filename: a.filename,
      mimeType: a.mime_type,
      bytesBase64: a.bytes_base64,
    })),
  };
}

composeFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  composeErrorEl.textContent = "";
  composeSendEl.disabled = true;
  composeSendEl.textContent = "Sending…";
  try {
    await invoke("send_message", gatherComposeFields({ forSend: true }));
    await emit("mail-sent", { editingDraft });
    currentWindow.close();
  } catch (err) {
    composeErrorEl.textContent = `${err}`;
    composeSendEl.disabled = false;
    composeSendEl.textContent = "Send";
  }
});

composeSaveDraftEl.addEventListener("click", async () => {
  composeErrorEl.textContent = "";
  composeSaveDraftEl.disabled = true;
  composeSaveDraftEl.textContent = "Saving…";
  try {
    const fields = gatherComposeFields();
    const wasEditingDraft = editingDraft !== null;
    await invoke("save_draft", fields);
    await emit("draft-saved", { fields, wasEditingDraft, editingDraft });
    currentWindow.close();
  } catch (err) {
    composeErrorEl.textContent = `${err}`;
    composeSaveDraftEl.disabled = false;
    composeSaveDraftEl.textContent = "Save draft";
  }
});

(async () => {
  let prefill = null;
  try {
    prefill = await invoke("take_pending_compose", { label: currentWindow.label });
  } catch (err) {
    console.error("take_pending_compose failed", err);
  }

  for (const entry of prefill?.addressBook ?? []) {
    recipientAddressBook.set(entry.address.toLowerCase(), entry);
  }

  editingDraft = prefill?.editingDraft ?? null;
  composeToEl.value = prefill?.to ?? "";
  composeSubjectEl.value = prefill?.subject ?? "";
  setComposeBodyHtml(prefill?.bodyHtml ?? "<p><br></p>");
  if (prefill?.cc) {
    revealComposeField(composeCcFieldEl, composeShowCcEl, composeCcEl);
    composeCcEl.value = prefill.cc;
  }
  composeInReplyTo = prefill?.inReplyTo ?? "";
  composeReferences = prefill?.references ?? "";
  composeForwardAttachments = prefill?.forwardAttachments ?? null;
  renderComposeAttachmentsBar();

  if (prefill?.bodyHtml) {
    placeComposeCaretAtStart();
  } else {
    composeToEl.focus();
  }

  let accounts = [];
  try {
    accounts = await invoke("list_accounts");
  } catch (err) {
    console.error("list_accounts failed", err);
    composeErrorEl.textContent = `Couldn't load accounts: ${err}`;
  }
  const desired = prefill?.account ?? "";
  composeAccountEl.innerHTML = accounts
    .map((a) => `<option value="${escapeHtml(a.email)}">${escapeHtml(a.email)}</option>`)
    .join("");
  composeAccountEl.value = accounts.some((a) => a.email === desired) ? desired : (accounts[0]?.email ?? "");
  composeAccountFieldEl.hidden = accounts.length < 2;

  composeAccounts = accounts;
  composeIsReplyLike = !!prefill?.mode;
  const existing = composeBodyEl.contentDocument.body.querySelector(`[${SIGNATURE_MARKER}]`);
  const acct = accountWithSignatures(composeAccountEl.value);
  if (editingDraft) {
    // Reopened draft: keep the saved signature block exactly as it was and
    // just reflect it in the controls.
    composeSignatureToggleEl.checked = existing !== null;
    fillSignatureSelect(composeAccountEl.value, existing?.getAttribute(SIGNATURE_MARKER));
    syncSignatureControl();
  } else {
    composeSignatureToggleEl.checked = !!acct && (!composeIsReplyLike || acct.signature_on_replies);
    fillSignatureSelect(composeAccountEl.value, null);
    refreshComposeSignature();
  }
})();

composeSignatureToggleEl.addEventListener("change", refreshComposeSignature);
composeSignatureSelectEl.addEventListener("change", refreshComposeSignature);

composeAccountEl.addEventListener("change", () => {
  const acct = accountWithSignatures(composeAccountEl.value);
  if (!editingDraft) {
    composeSignatureToggleEl.checked = !!acct && (!composeIsReplyLike || acct.signature_on_replies);
  }
  fillSignatureSelect(composeAccountEl.value, null);
  refreshComposeSignature();
});
