const { invoke } = window.__TAURI__.core;

const statusEl = document.getElementById("status");

// Exponential backoff for retrying a failed load - doubles the delay each retry (capped) so a
// persistent outage doesn't hammer the server every few seconds forever; reset on success.
let statusRetryTimer = null;
let statusRetryDelayMs = 3000;
const STATUS_RETRY_MAX_MS = 60000;
function scheduleStatusRetry(fn) {
  clearTimeout(statusRetryTimer);
  statusRetryTimer = setTimeout(() => {
    fn();
  }, statusRetryDelayMs);
  statusRetryDelayMs = Math.min(statusRetryDelayMs * 2, STATUS_RETRY_MAX_MS);
}
function clearStatusRetry() {
  clearTimeout(statusRetryTimer);
  statusRetryTimer = null;
  statusRetryDelayMs = 3000;
}
const toastStackEl = document.getElementById("toast-stack");
const settingsButtonEl = document.getElementById("settings-button");
const removeAccountOverlayEl = document.getElementById("remove-account-overlay");
const removeAccountFormEl = document.getElementById("remove-account-form");
const removeAccountTargetEl = document.getElementById("remove-account-target");
const removeAccountErrorEl = document.getElementById("remove-account-error");
const removeAccountConfirmEl = document.getElementById("remove-account-confirm");
const addAccountOverlayEl = document.getElementById("add-account-overlay");
const addAccountTitleEl = document.getElementById("add-account-title");
const addAccountFormEl = document.getElementById("add-account-form");
const addAccountEmailEl = document.getElementById("add-account-email");
const addAccountErrorEl = document.getElementById("add-account-error");
const addAccountSendEl = document.getElementById("add-account-send");
const addAccountManualHostFieldsEl = document.getElementById("add-account-manual-host-fields");
const addAccountPasswordFieldEl = document.getElementById("add-account-password-field");
const addAccountPasswordEl = document.getElementById("add-account-password");
const addAccountImapHostEl = document.getElementById("add-account-imap-host");
const addAccountImapPortEl = document.getElementById("add-account-imap-port");
const addAccountSmtpHostEl = document.getElementById("add-account-smtp-host");
const addAccountSmtpPortEl = document.getElementById("add-account-smtp-port");
const addAccountStatusEl = document.getElementById("add-account-status");
const addAccountStatusTextEl = document.getElementById("add-account-status-text");
const mailboxTabsEl = document.getElementById("mailbox-tabs");
const listEl = document.getElementById("regular-list");
const pinnedFolderEl = document.getElementById("pinned-folder");
const pinnedListEl = document.getElementById("pinned-list");
const pinnedFolderCountEl = document.getElementById("pinned-folder-count");
const readingPaneEl = document.getElementById("reading-pane");

let openMessageHash = null;
let editingDraft = null;

function showEmptyReadingPane() {
  openMessageHash = null;
  readingPaneEl.innerHTML =
    '<div class="reading-pane-empty">' +
    '<img class="reading-pane-empty-logo" src="assets/empty-state-logo.png" alt="" />' +
    '<p class="placeholder">Select a message</p>' +
    "</div>";
}
const searchInputEl = document.getElementById("search-input");
const searchClearEl = document.getElementById("search-clear");
const inboxListEl = document.getElementById("inbox-list");
const searchResultsEl = document.getElementById("search-results");
const searchGridBodyEl = document.getElementById("search-grid-body");
const composeButtonEl = document.getElementById("compose-button");
const composeOverlayEl = document.getElementById("compose-overlay");
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

setupRecipientAutocomplete(composeToEl, document.getElementById("compose-to-suggestions"));
setupRecipientAutocomplete(composeCcEl, document.getElementById("compose-cc-suggestions"));
setupRecipientAutocomplete(composeBccEl, document.getElementById("compose-bcc-suggestions"));

const composeBodyEl = document.getElementById("compose-body");
const composeToolbarEl = document.getElementById("compose-toolbar");
const composeLinkButtonEl = document.getElementById("compose-link-button");
const composeTextColorEl = document.getElementById("compose-text-color");
const composeHighlightColorEl = document.getElementById("compose-highlight-color");
const composeAttachmentsBarEl = document.getElementById("compose-attachments-bar");
const composeErrorEl = document.getElementById("compose-error");
const composeSendEl = document.getElementById("compose-send");
const composeSaveDraftEl = document.getElementById("compose-save-draft");
const mailboxContextMenuEl = document.getElementById("mailbox-context-menu");
const createMailboxOverlayEl = document.getElementById("create-mailbox-overlay");
const createMailboxFormEl = document.getElementById("create-mailbox-form");
const createMailboxTitleEl = document.getElementById("create-mailbox-title");
const createMailboxNameEl = document.getElementById("create-mailbox-name");
const createMailboxErrorEl = document.getElementById("create-mailbox-error");
const createMailboxSendEl = document.getElementById("create-mailbox-send");
const deleteMailboxOverlayEl = document.getElementById("delete-mailbox-overlay");
const deleteMailboxFormEl = document.getElementById("delete-mailbox-form");
const deleteMailboxSummaryEl = document.getElementById("delete-mailbox-summary");
const deleteMailboxSubfoldersEl = document.getElementById("delete-mailbox-subfolders");
const deleteMailboxMoveLabelEl = document.getElementById("delete-mailbox-move-label");
const deleteMailboxErrorEl = document.getElementById("delete-mailbox-error");
const deleteMailboxConfirmEl = document.getElementById("delete-mailbox-confirm");
const emptyMailboxOverlayEl = document.getElementById("empty-mailbox-overlay");
const emptyMailboxFormEl = document.getElementById("empty-mailbox-form");
const emptyMailboxTitleEl = document.getElementById("empty-mailbox-title");
const emptyMailboxSummaryEl = document.getElementById("empty-mailbox-summary");
const emptyMailboxErrorEl = document.getElementById("empty-mailbox-error");
const emptyMailboxConfirmEl = document.getElementById("empty-mailbox-confirm");
const forwardAttachmentsOverlayEl = document.getElementById("forward-attachments-overlay");
const forwardAttachmentsSummaryEl = document.getElementById("forward-attachments-summary");
const forwardAttachmentsSkipEl = document.getElementById("forward-attachments-skip");
const forwardAttachmentsIncludeEl = document.getElementById("forward-attachments-include");
const forwardAttachmentsCloseEl = document.getElementById("forward-attachments-close");

let currentMailboxHash = null;
let activeAccount = "";
let hasAccount = true;
let pendingRemoveEmail = null;
let unifiedActive = false;
let currentUnifiedCategory = "Inbox";
let mailboxesByAccount = {};
let searchActive = false;
let searchQuery = "";
let searchResults = [];
let searchSort = { column: "date", dir: "desc" };
let searchRenderFrameRequested = false;
let searchRenderPending = null;

// Quick filters (mailbox list only, not the cross-account search grid,
// which already has its own is:unread/has:attachment operators). Session-only
// on purpose - simpler than a persisted per-mailbox setting, and these are
// meant to be quick toggles rather than durable view state.
let filterUnreadOnly = false;
let filterAttachmentOnly = false;
// Separate from the two filters above - this doesn't remove rows, it
// changes how the remaining rows are grouped for display. Unlike the
// session-only filters, this is a persisted view-mode preference (settings
// panel toggle, same convention as Unified Inbox/Show account labels).
let threadViewEnabled = localStorage.getItem("threadViewEnabled") === "1";
let lastMailboxRows = null;
let lastUnifiedRows = null;

// Populated once at startup by the fire-and-forget update check below -
// null until (and unless) a real newer release is found. Silent on any
// failure (offline, rate-limited, GitHub down) - this is a best-effort
// notice, not something that should ever surface an error to the user.
let availableUpdate = null;
let currentAppVersion = "";
invoke("app_version")
  .then((v) => {
    currentAppVersion = v;
  })
  .catch(() => {});

// Real reference-chain threading (not subject-matching) - a message links
// to any ancestor whose Message-ID appears anywhere in its own References
// list, not just the immediate parent. This means a thread still holds
// together even if an intermediate reply is missing from this mailbox
// (e.g. it lives in Sent, or was deleted), as long as some ancestor is
// still present. Pure client-side, over rows already fully loaded for the
// mailbox - no new backend calls, everything it needs (message_id/
// references) rides on data already fetched for the list.
//
// Union-find with path compression: each row starts as its own set: two
// rows land in the same set the moment either references the other's
// Message-ID. Cheap and correct regardless of how many hops apart two
// related messages are, or in what order rows happen to arrive in.
function buildThreads(rows) {
  const byMessageId = new Map();
  for (const row of rows) {
    if (row.message_id) byMessageId.set(row.message_id, row);
  }

  const parent = new Map();
  const find = (key) => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = key;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const row of rows) {
    const key = row.message_id || `__no-id-${row.hash}`;
    if (!parent.has(key)) parent.set(key, key);
  }
  for (const row of rows) {
    if (!row.message_id || !row.references) continue;
    const ancestorIds = row.references.split(/\s+/).filter(Boolean);
    for (const ancestorId of ancestorIds) {
      if (byMessageId.has(ancestorId)) {
        union(row.message_id, ancestorId);
      }
    }
  }

  const groups = new Map();
  for (const row of rows) {
    const key = row.message_id || `__no-id-${row.hash}`;
    const root = find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(row);
  }

  const threads = [];
  for (const messages of groups.values()) {
    messages.sort((a, b) => b.date - a.date);
    threads.push({ messages, latestDate: messages[0].date });
  }
  threads.sort((a, b) => b.latestDate - a.latestDate);
  return threads;
}

// Session-only, same as the other view-state above - which threads are
// currently expanded. Keyed by the thread's latest message's hash (stable
// across re-renders as long as that message stays "latest" in the group).
let expandedThreadKeys = new Set();

function toggleThreadExpanded(key) {
  if (expandedThreadKeys.has(key)) expandedThreadKeys.delete(key);
  else expandedThreadKeys.add(key);
  rerenderCurrentMailboxView();
}

// Flattens buildThreads()'s output back into the same flat row shape the
// (non-threaded) virtual list already expects - a lone message is just
// itself; a thread of 2+ becomes one "header" row (a shallow clone of its
// latest message, tagged with thread metadata for buildRow() to render a
// chevron+count on) followed by the rest of the thread's messages when
// expanded. Every item is still a single normal-height row either way, so
// the existing fixed-row-height virtualizer needs no changes at all -
// expanding/collapsing just changes how many flat items there are, not
// any item's own height.
function flattenThreads(threads) {
  const flat = [];
  for (const thread of threads) {
    // Mutate the real row objects in place (never clone) - togglePin/
    // toggleRead update row.is_flagged/is_seen directly on whatever object
    // reference they're handed, expecting it to be the same one held in
    // lastMailboxRows/lastUnifiedRows. A clone here would silently revert
    // on the next re-render since the mutation would land on a throwaway
    // copy instead. The __thread* markers are just ephemeral per-render
    // tags on the real object, reset every time this runs.
    for (const msg of thread.messages) {
      delete msg.__threadCount;
      delete msg.__threadKey;
      delete msg.__threadExpanded;
      delete msg.__isThreadChild;
    }
    if (thread.messages.length === 1) {
      flat.push(thread.messages[0]);
      continue;
    }
    const header = thread.messages[0];
    const key = header.hash;
    const expanded = expandedThreadKeys.has(key);
    header.__threadCount = thread.messages.length;
    header.__threadKey = key;
    header.__threadExpanded = expanded;
    flat.push(header);
    if (expanded) {
      for (const msg of thread.messages.slice(1)) {
        msg.__isThreadChild = true;
        flat.push(msg);
      }
    }
  }
  return flat;
}

function applyQuickFilters(rows) {
  if (!filterUnreadOnly && !filterAttachmentOnly) return rows;
  return rows.filter((row) => {
    if (filterUnreadOnly && row.is_seen) return false;
    if (filterAttachmentOnly && !row.has_attachments) return false;
    return true;
  });
}

function scheduleSearchRender(render) {
  searchRenderPending = render;
  if (searchRenderFrameRequested) return;
  searchRenderFrameRequested = true;
  requestAnimationFrame(() => {
    searchRenderFrameRequested = false;
    const pending = searchRenderPending;
    searchRenderPending = null;
    if (pending) pending();
  });
}

let preSearchState = null;
let showAccountPills = localStorage.getItem("showAccountPills") !== "0";

const ACCOUNT_COLORS = [
  { bg: "rgba(96, 165, 250, 0.16)", fg: "#60a5fa" },
  { bg: "rgba(52, 211, 153, 0.16)", fg: "#34d399" },
  { bg: "rgba(217, 154, 27, 0.18)", fg: "#d99a1b" },
  { bg: "rgba(244, 114, 182, 0.16)", fg: "#f472b6" },
  { bg: "rgba(45, 212, 191, 0.16)", fg: "#2dd4bf" },
  { bg: "rgba(248, 113, 113, 0.16)", fg: "#f87171" },
];

function accountColor(account) {
  let hash = 0;
  for (let i = 0; i < account.length; i++) {
    hash = (hash * 31 + account.charCodeAt(i)) >>> 0;
  }
  return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length];
}

document.getElementById("pinned-folder-toggle").addEventListener("click", () => {
  pinnedFolderEl.classList.toggle("expanded");
});

// Re-renders from whichever rows were last fetched (mailbox or unified view)
// rather than re-fetching - toggling a quick filter is purely a display
// concern, the underlying data hasn't changed.
function rerenderCurrentMailboxView() {
  if (unifiedActive) {
    if (lastUnifiedRows) renderUnifiedRows(lastUnifiedRows);
  } else if (lastMailboxRows) {
    renderMessageRows(lastMailboxRows);
  }
}

const quickFilterUnreadEl = document.getElementById("quick-filter-unread");
const quickFilterAttachmentEl = document.getElementById("quick-filter-attachment");

quickFilterUnreadEl.addEventListener("click", () => {
  filterUnreadOnly = !filterUnreadOnly;
  quickFilterUnreadEl.setAttribute("aria-pressed", String(filterUnreadOnly));
  rerenderCurrentMailboxView();
});

quickFilterAttachmentEl.addEventListener("click", () => {
  filterAttachmentOnly = !filterAttachmentOnly;
  quickFilterAttachmentEl.setAttribute("aria-pressed", String(filterAttachmentOnly));
  rerenderCurrentMailboxView();
});

document.addEventListener("contextmenu", (e) => e.preventDefault());

mailboxTabsEl.addEventListener("contextmenu", (e) => {
  if (e.target !== mailboxTabsEl) return;
  e.preventDefault();
  openMailboxContextMenu(e.clientX, e.clientY, null);
});

const ICONS = {
  reply: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5A5.5 5.5 0 0 1 20 14.5V16"/></svg>`,
  replyAll: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17 6 12l5-5"/><path d="M18 17l-5-5 5-5"/></svg>`,
  forward: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5V16"/></svg>`,
  delete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>`,
  moveTo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6"/><path d="m9.5 13.5 2.5-2.5 2.5 2.5"/></svg>`,
  pinOutline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`,
  pinFilled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`,
  mailClosed: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`,
  mailOpen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 9 12 3l9 6"/><path d="M7 13h10"/></svg>`,
  attachment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  hamburger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>`,
  pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
  coffee: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/></svg>`,
  plusCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>`,
};

function remoteImagesKey() {
  return `allowedRemoteImages:${activeAccount}`;
}

function getAllowedRemoteImages() {
  try {
    return new Set(JSON.parse(localStorage.getItem(remoteImagesKey()) || "[]"));
  } catch {
    return new Set();
  }
}

function rememberRemoteImagesAllowed(hash) {
  try {
    const allowed = getAllowedRemoteImages();
    allowed.add(hash);
    localStorage.setItem(remoteImagesKey(), JSON.stringify([...allowed]));
  } catch {
  }
}

function hiddenMailboxesKey(account = activeAccount) {
  return `hiddenMailboxes:${account}`;
}

function getHiddenMailboxes(account = activeAccount) {
  try {
    return new Set(JSON.parse(localStorage.getItem(hiddenMailboxesKey(account)) || "[]"));
  } catch {
    return new Set();
  }
}

function setHiddenMailboxes(hiddenSet, account = activeAccount) {
  try {
    localStorage.setItem(hiddenMailboxesKey(account), JSON.stringify([...hiddenSet]));
  } catch {
  }
}

function mailboxOrderKey() {
  return `mailboxOrder:${activeAccount}`;
}

function getMailboxOrder() {
  try {
    return JSON.parse(localStorage.getItem(mailboxOrderKey()) || "[]");
  } catch {
    return [];
  }
}

function setMailboxOrder(order) {
  try {
    localStorage.setItem(mailboxOrderKey(), JSON.stringify(order));
  } catch {
  }
}

function orderedMailboxes(list = mailboxes) {
  const order = list === mailboxes ? getMailboxOrder() : [];
  if (order.length === 0) return list;
  const byHash = new Map(list.map((m) => [m.hash, m]));
  const ordered = [];
  for (const hash of order) {
    const m = byHash.get(hash);
    if (m) {
      ordered.push(m);
      byHash.delete(hash);
    }
  }
  for (const m of list) {
    if (byHash.has(m.hash)) ordered.push(m);
  }
  return ordered;
}

function reorderedMailboxHashes(draggedHash, targetHash) {
  const order = orderedMailboxes().map((m) => m.hash);
  const from = order.indexOf(draggedHash);
  const to = order.indexOf(targetHash);
  if (from === -1 || to === -1 || from === to) return order;
  order.splice(from, 1);
  order.splice(to, 0, draggedHash);
  return order;
}

let totalCount = 0;
let unreadCount = 0;
let currentMailboxOwnUnread = 0;

const TOAST_LIFETIME_MS = 5000;

function showToast(message, kind = "error") {
  const toast = document.createElement("div");
  toast.className = kind === "success" ? "toast toast-success" : "toast";
  toast.setAttribute("role", "alert");

  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = message;
  toast.appendChild(text);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "toast-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  toast.appendChild(dismiss);

  const remove = () => {
    toast.classList.add("toast-leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  };
  dismiss.addEventListener("click", remove);
  const timer = setTimeout(remove, TOAST_LIFETIME_MS);
  dismiss.addEventListener("click", () => clearTimeout(timer), { once: true });

  toastStackEl.appendChild(toast);
}

function showErrorToast(message) {
  showToast(message, "error");
}

function updateStatus() {
  clearStatusRetry();
  if (searchActive) return;
  statusEl.textContent = `Messages ${totalCount} · Unread ${unreadCount}`;
  if (!unifiedActive) syncCurrentMailboxUnreadBadge();
}

function resetToSignedOutState() {
  hasAccount = false;
  unifiedActive = false;
  localStorage.setItem("unifiedActive", "");
  mailboxes = [];
  mailboxesByAccount = {};
  currentMailboxHash = null;
  totalCount = 0;
  unreadCount = 0;
  currentMailboxOwnUnread = 0;
  mailboxTabsEl.innerHTML = "";
  virtualRows = [];
  virtualRowBuilder = null;
  listEl.innerHTML = "";
  pinnedListEl.innerHTML = "";
  updatePinnedFolderCount();
  showEmptyReadingPane();
  statusEl.textContent = "Use the + in the settings panel to add an account";
}

function buildRow(row, canMove) {
  const li = document.createElement("li");
  li.className = "inbox-row";
  li.dataset.hash = String(row.hash);
  if (!row.is_seen) li.classList.add("unread");
  if (row.__threadCount > 1) li.classList.add("has-thread-toggle");
  if (row.__isThreadChild) li.classList.add("thread-child-row");
  // Re-derive the highlight at build time, not just at click time - the
  // virtual list rebuilds every row from scratch on any re-render (scroll,
  // quick-filter toggle, thread expand/collapse), which was silently
  // dropping the currently-open message's highlight since openMessage()
  // only ever set .selected as a one-off DOM mutation on the specific <li>
  // clicked, with nothing to reapply it once that element was discarded.
  if (row.hash === openMessageHash) li.classList.add("selected");
  let chipHtml = "";
  if (unifiedActive && showAccountPills) {
    const color = accountColor(row.account);
    chipHtml = `<span class="account-chip" style="background:${color.bg};color:${color.fg}" title="${escapeHtml(row.account)}">${escapeHtml(row.account.split("@")[0])}</span>`;
  }
  const threadToggleHtml =
    row.__threadCount > 1
      ? `<button type="button" class="thread-toggle" title="${row.__threadExpanded ? "Collapse thread" : "Expand thread"}">
           <span class="thread-toggle-chevron"></span>${row.__threadCount}
         </button>`
      : "";
  li.innerHTML = `<div class="row-hover-zone row-hover-zone-right"></div>
    <div class="row-actions">
      <button class="row-action" data-action="pin" title="${row.is_flagged ? "Unpin" : "Pin"}">${row.is_flagged ? ICONS.pinFilled : ICONS.pinOutline}</button>
      <button class="row-action" data-action="toggle-read" title="${row.is_seen ? "Mark unread" : "Mark read"}">${row.is_seen ? ICONS.mailOpen : ICONS.mailClosed}</button>
      <button class="row-action" data-action="reply" title="Reply">${ICONS.reply}</button>
      <button class="row-action" data-action="reply-all" title="Reply All">${ICONS.replyAll}</button>
      <button class="row-action" data-action="forward" title="Forward">${ICONS.forward}</button>
      ${canMove ? `<button class="row-action" data-action="move-to" title="Move to&hellip;">${ICONS.moveTo}</button>` : ""}
      <button class="row-action" data-action="delete" title="Delete">${ICONS.delete}</button>
    </div>
    ${threadToggleHtml}
    <div class="sender-line">
      <span class="sender-name"><span class="unread-dot" title="Unread"></span>${escapeHtml(row.from)}</span>
      ${row.has_attachments ? `<span class="attachment-icon" title="Has attachment">${ICONS.attachment}</span>` : ""}
      ${chipHtml}
      <span class="received-date">${escapeHtml(formatReceivedDate(row.date))}</span>
    </div>
    <div class="subject-line">${escapeHtml(row.subject)}</div>`;
  // Clicking the header row body does both: opens that message (it's never
  // separately re-listed among the revealed children, so this is the only
  // way to actually read it) and expands the thread if it isn't already -
  // doesn't re-collapse on a second click, since that's the chevron's own
  // dedicated job below, not something a click that's also opening a
  // message should surprise you with.
  li.addEventListener("click", () => {
    openMessage(row, li);
    if (row.__threadCount > 1 && !row.__threadExpanded) {
      toggleThreadExpanded(row.__threadKey);
    }
  });
  if (row.__threadCount > 1) {
    li.querySelector(".thread-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleThreadExpanded(row.__threadKey);
    });
    if (row.__threadExpanded) li.classList.add("thread-expanded");
  }

  const rowActionsEl = li.querySelector(".row-actions");
  rowActionsEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const button = e.target.closest(".row-action");
    if (!button) return;
    if (button.dataset.action === "pin") {
      togglePin(row, button, li);
    } else if (button.dataset.action === "toggle-read") {
      toggleRead(row, li);
    } else if (button.dataset.action === "delete") {
      deleteMessage(row, li);
    } else if (button.dataset.action === "move-to") {
      const rect = button.getBoundingClientRect();
      openMoveMenu(rect.left, rect.bottom + 4, row, li);
    } else if (
      button.dataset.action === "reply" ||
      button.dataset.action === "reply-all" ||
      button.dataset.action === "forward"
    ) {
      replyToMessage(row, button.dataset.action);
    }
  });

  const rightZoneEl = li.querySelector(".row-hover-zone-right");
  rightZoneEl.addEventListener("mouseenter", () => {
    li.classList.add("actions-visible-right");
  });
  li.addEventListener("mouseleave", () => {
    li.classList.remove("actions-visible-right");
  });

  return li;
}

function updatePinnedFolderCount() {
  pinnedFolderCountEl.textContent = `(${pinnedListEl.children.length})`;
}

let mailboxes = [];

function isEffectivelyTopLevel(mailbox) {
  if (!mailbox.parent_hash || mailbox.special_usage !== "Normal") return true;
  const parent = mailboxes.find((m) => m.hash === mailbox.parent_hash);
  return parent?.special_usage === "Inbox";
}

function effectiveChildren(hash, list = mailboxes) {
  return orderedMailboxes(list).filter(
    (m) => m.parent_hash === hash && m.special_usage === "Normal",
  );
}

function allDescendantHashes(hash) {
  const direct = effectiveChildren(hash);
  let hashes = direct.map((m) => m.hash);
  for (const child of direct) hashes = hashes.concat(allDescendantHashes(child.hash));
  return hashes;
}

function descendantMailboxes(hash) {
  return allDescendantHashes(hash)
    .map((h) => mailboxes.find((m) => m.hash === h))
    .filter(Boolean);
}

function rollupUnread(mailbox) {
  const own = mailboxTracksUnread(mailbox) ? mailbox.unread : 0;
  return (
    own +
    descendantMailboxes(mailbox.hash)
      .filter(mailboxTracksUnread)
      .reduce((sum, m) => sum + m.unread, 0)
  );
}

function rollupTotal(mailbox) {
  return mailbox.total + descendantMailboxes(mailbox.hash).reduce((sum, m) => sum + m.total, 0);
}

function ancestorHashes(hash) {
  const mailbox = mailboxes.find((m) => m.hash === hash);
  if (!mailbox || isEffectivelyTopLevel(mailbox)) return [];
  const parent = mailboxes.find((m) => m.hash === mailbox.parent_hash);
  if (!parent) return [];
  return [parent.hash, ...ancestorHashes(parent.hash)];
}

let currentTabLevelParentHash = null;

function currentLevelMailboxes() {
  const hidden = getHiddenMailboxes();
  const ordered = orderedMailboxes().filter((m) => !hidden.has(m.hash));
  if (currentTabLevelParentHash === null) {
    return ordered.filter(isEffectivelyTopLevel);
  }
  const inbox = ordered.find((m) => m.special_usage === "Inbox");
  const parent = ordered.find((m) => m.hash === currentTabLevelParentHash);
  const children = effectiveChildren(currentTabLevelParentHash).filter((m) => !hidden.has(m.hash));
  const result = [];
  if (inbox) result.push(inbox);
  if (parent && parent.hash !== inbox?.hash) result.push(parent);
  for (const child of children) {
    if (child.hash !== inbox?.hash) result.push(child);
  }
  return result;
}

let dragState = null;
let suppressNextTabClick = false;

function onTabPointerMove(e) {
  if (!dragState) return;
  const dx = Math.abs(e.clientX - dragState.startX);
  const dy = Math.abs(e.clientY - dragState.startY);
  if (!dragState.dragging && (dx > 4 || dy > 4)) {
    dragState.dragging = true;
    mailboxTabsEl
      .querySelector(`.mailbox-tab[data-hash="${dragState.hash}"]`)
      ?.classList.add("dragging");
  }
  if (!dragState.dragging) return;
  mailboxTabsEl
    .querySelectorAll(".mailbox-tab.drag-over")
    .forEach((el) => el.classList.remove("drag-over"));
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".mailbox-tab");
  if (target && target.dataset.hash !== dragState.hash) {
    target.classList.add("drag-over");
  }
}

function onTabPointerUp(e) {
  document.removeEventListener("mousemove", onTabPointerMove);
  document.removeEventListener("mouseup", onTabPointerUp);
  if (!dragState) return;
  const { hash: draggedHash, dragging: wasDragging } = dragState;
  dragState = null;
  if (!wasDragging) return;
  mailboxTabsEl
    .querySelectorAll(".mailbox-tab.dragging, .mailbox-tab.drag-over")
    .forEach((el) => el.classList.remove("dragging", "drag-over"));
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".mailbox-tab");
  if (target?.dataset.hash && target.dataset.hash !== draggedHash) {
    setMailboxOrder(reorderedMailboxHashes(draggedHash, target.dataset.hash));
  }
  suppressNextTabClick = true;
  renderMailboxTabs();
}

function mailboxTracksUnread(mailbox) {
  return mailbox.special_usage !== "Sent";
}

function mailboxBadgeCount(mailbox) {
  return mailbox.special_usage === "Drafts" ? rollupTotal(mailbox) : rollupUnread(mailbox);
}

function renderMailboxTabs() {
  mailboxTabsEl.innerHTML = "";
  const viewingSearch = !searchResultsEl.hidden;
  for (const mailbox of currentLevelMailboxes()) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "mailbox-tab" + (!viewingSearch && mailbox.hash === currentMailboxHash ? " active" : "");
    if (mailbox.hash === currentTabLevelParentHash) tab.classList.add("drilled-into");
    tab.dataset.hash = mailbox.hash;
    const badgeCount = mailboxBadgeCount(mailbox);
    tab.innerHTML =
      `<span class="mailbox-tab-name">${escapeHtml(mailbox.name)}</span>` +
      (badgeCount > 0 ? `<span class="mailbox-tab-badge">${badgeCount}</span>` : "");
    tab.addEventListener("click", () => {
      if (suppressNextTabClick) {
        suppressNextTabClick = false;
        return;
      }
      const hasChildren = effectiveChildren(mailbox.hash).some((child) => !isEffectivelyTopLevel(child));
      let levelChanged = false;
      if (mailbox.special_usage === "Inbox" && currentTabLevelParentHash !== null) {
        currentTabLevelParentHash = null;
        levelChanged = true;
      } else if (hasChildren && currentTabLevelParentHash !== mailbox.hash) {
        currentTabLevelParentHash = mailbox.hash;
        levelChanged = true;
      }
      if (mailbox.hash === currentMailboxHash && !viewingSearch) {
        if (levelChanged) renderMailboxTabs();
        return;
      }
      switchMailbox(mailbox.hash);
    });
    tab.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragState = { hash: mailbox.hash, startX: e.clientX, startY: e.clientY, dragging: false };
      document.addEventListener("mousemove", onTabPointerMove);
      document.addEventListener("mouseup", onTabPointerUp);
    });
    tab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openMailboxContextMenu(e.clientX, e.clientY, mailbox);
    });

    mailboxTabsEl.appendChild(tab);
  }

  appendSearchTab();

  const manageBtn = document.createElement("button");
  manageBtn.type = "button";
  manageBtn.className = "mailbox-manage-toggle";
  manageBtn.title = "Choose which folders to show";
  manageBtn.innerHTML = ICONS.gear;
  manageBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMailboxManagePanel();
  });
  const rightGroup = document.createElement("div");
  rightGroup.className = "mailbox-tabs-right";
  const updateIndicator = buildUpdateIndicator();
  if (updateIndicator) rightGroup.appendChild(updateIndicator);
  rightGroup.appendChild(manageBtn);
  mailboxTabsEl.appendChild(rightGroup);
}

let mailboxContextMenuMailbox = null;

let mailboxContextMenuUnifiedCategory = null;

function openMailboxContextMenu(x, y, mailbox, unifiedCategory = null) {
  mailboxContextMenuMailbox = mailbox;
  mailboxContextMenuUnifiedCategory = unifiedCategory;

  const newAction = mailboxContextMenuEl.querySelector('[data-action="new"]');
  newAction.parentElement.hidden = unifiedActive;
  const deleteAction = mailboxContextMenuEl.querySelector('[data-action="delete"]');
  deleteAction.parentElement.hidden = unifiedActive || !mailbox || mailbox.special_usage !== "Normal";

  const markAllReadAction = mailboxContextMenuEl.querySelector('[data-action="mark-all-read"]');
  markAllReadAction.parentElement.hidden = !mailbox && !unifiedCategory;

  const specialUsage = mailbox ? mailbox.special_usage : unifiedCategory;
  const emptyAction = mailboxContextMenuEl.querySelector('[data-action="empty"]');
  emptyAction.parentElement.hidden =
    (!mailbox && !unifiedCategory) || (specialUsage !== "Trash" && specialUsage !== "Junk");

  mailboxContextMenuEl.hidden = false;

  const rect = mailboxContextMenuEl.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  mailboxContextMenuEl.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
  mailboxContextMenuEl.style.top = `${Math.max(0, Math.min(y, maxY))}px`;

  // Listener registration delayed to the next tick to avoid the opening click immediately triggering a close
  setTimeout(() => document.addEventListener("click", closeMailboxContextMenuOnOutsideClick), 0);
}

function closeMailboxContextMenu() {
  mailboxContextMenuEl.hidden = true;
  document.removeEventListener("click", closeMailboxContextMenuOnOutsideClick);
}

function closeMailboxContextMenuOnOutsideClick(e) {
  if (!mailboxContextMenuEl.contains(e.target)) closeMailboxContextMenu();
}

mailboxContextMenuEl.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;
  const mailbox = mailboxContextMenuMailbox;
  const unifiedCategory = mailboxContextMenuUnifiedCategory;
  closeMailboxContextMenu();
  if (button.dataset.action === "new") {
    openCreateMailbox(mailbox);
  } else if (button.dataset.action === "mark-all-read") {
    if (unifiedCategory) void markAllReadUnified(unifiedCategory);
    else if (mailbox) void markAllRead(mailbox);
  } else if (button.dataset.action === "empty") {
    if (unifiedCategory) openEmptyMailboxModal(null, unifiedCategory);
    else if (mailbox) openEmptyMailboxModal(mailbox);
  } else if (button.dataset.action === "delete" && mailbox) {
    void deleteMailboxTab(mailbox);
  }
});

let createMailboxParent = null;
let createMailboxAccount = null;
let createMailboxUnified = false;

function openCreateMailbox(parentMailbox, account = activeAccount, unified = false) {
  createMailboxParent = parentMailbox;
  createMailboxAccount = account;
  createMailboxUnified = unified;
  const title = parentMailbox ? `New folder in ${parentMailbox.name}` : "New folder";
  createMailboxTitleEl.textContent = unified ? `${title} (${account})` : title;
  createMailboxFormEl.reset();
  createMailboxErrorEl.textContent = "";
  createMailboxOverlayEl.hidden = false;
  createMailboxNameEl.focus();
}

function closeCreateMailbox() {
  createMailboxOverlayEl.hidden = true;
}

document.getElementById("create-mailbox-cancel").addEventListener("click", closeCreateMailbox);
document.getElementById("create-mailbox-close").addEventListener("click", closeCreateMailbox);
createMailboxOverlayEl.addEventListener("click", (e) => {
  if (e.target === createMailboxOverlayEl) closeCreateMailbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !createMailboxOverlayEl.hidden) closeCreateMailbox();
});

createMailboxFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = createMailboxNameEl.value.trim();
  const path = createMailboxParent ? `${createMailboxParent.path}/${name}` : name;
  const account = createMailboxAccount;
  const unified = createMailboxUnified;
  createMailboxErrorEl.textContent = "";
  createMailboxSendEl.disabled = true;
  createMailboxSendEl.textContent = "Creating…";
  try {
    const updated = await invoke("create_mailbox", { account, path });
    closeCreateMailbox();
    if (unified) {
      mailboxesByAccount[account] = updated;
      if (unifiedManagePanelEl) renderUnifiedManagePanelBody(unifiedManagePanelEl);
      renderUnifiedTabs();
    } else {
      mailboxes = updated;
      const created = mailboxes.find((m) => m.path === path);
      if (created) {
        currentTabLevelParentHash = createMailboxParent ? createMailboxParent.hash : null;
        await switchMailbox(created.hash);
      } else {
        renderMailboxTabs();
      }
    }
  } catch (err) {
    createMailboxErrorEl.textContent = `${err}`;
  } finally {
    createMailboxSendEl.disabled = false;
    createMailboxSendEl.textContent = "Create";
  }
});

function computeMailboxDeletionImpact(mailbox) {
  const descendantHashes = allDescendantHashes(mailbox.hash);
  const affected = [mailbox, ...descendantHashes.map((h) => mailboxes.find((m) => m.hash === h))].filter(
    Boolean,
  );
  const totalMessages = affected.reduce((sum, m) => sum + (m.total ?? 0), 0);
  return { descendantHashes, totalMessages };
}

let deleteMailboxTarget = null;

function openDeleteMailboxModal(mailbox, descendantHashes, totalMessages) {
  deleteMailboxTarget = mailbox;
  const parentMailbox = mailbox.parent_hash
    ? mailboxes.find((m) => m.hash === mailbox.parent_hash)
    : null;
  deleteMailboxMoveLabelEl.textContent = `Move messages to ${parentMailbox ? parentMailbox.name : "Inbox"}`;

  const parts = [];
  if (totalMessages > 0) parts.push(`${totalMessages} message${totalMessages === 1 ? "" : "s"}`);
  if (descendantHashes.length > 0) {
    parts.push(`${descendantHashes.length} subfolder${descendantHashes.length === 1 ? "" : "s"}`);
  }
  deleteMailboxSummaryEl.textContent =
    `"${mailbox.name}" contains ${parts.join(" and ")}.\n` + "Choose what happens to its messages:";

  if (descendantHashes.length > 0) {
    const names = descendantHashes
      .map((h) => mailboxes.find((m) => m.hash === h)?.name)
      .filter(Boolean);
    deleteMailboxSubfoldersEl.textContent = `Subfolders: ${names.join(", ")}`;
    deleteMailboxSubfoldersEl.hidden = false;
  } else {
    deleteMailboxSubfoldersEl.hidden = true;
  }

  deleteMailboxErrorEl.textContent = "";
  deleteMailboxFormEl.reset();
  deleteMailboxOverlayEl.hidden = false;
}

function closeDeleteMailboxModal() {
  deleteMailboxOverlayEl.hidden = true;
  deleteMailboxTarget = null;
}

document.getElementById("delete-mailbox-cancel").addEventListener("click", closeDeleteMailboxModal);
document.getElementById("delete-mailbox-close").addEventListener("click", closeDeleteMailboxModal);
deleteMailboxOverlayEl.addEventListener("click", (e) => {
  if (e.target === deleteMailboxOverlayEl) closeDeleteMailboxModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !deleteMailboxOverlayEl.hidden) closeDeleteMailboxModal();
});

deleteMailboxFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const policy = deleteMailboxFormEl.querySelector('input[name="delete-mailbox-policy"]:checked').value;
  const mailbox = deleteMailboxTarget;
  deleteMailboxErrorEl.textContent = "";
  deleteMailboxConfirmEl.disabled = true;
  deleteMailboxConfirmEl.textContent = "Deleting…";
  try {
    await performMailboxDeletion(mailbox, policy);
    closeDeleteMailboxModal();
  } catch (err) {
    deleteMailboxErrorEl.textContent = `${err}`;
  } finally {
    deleteMailboxConfirmEl.disabled = false;
    deleteMailboxConfirmEl.textContent = "Delete folder";
  }
});

async function performMailboxDeletion(mailbox, policy) {
  mailboxes = await invoke("delete_mailbox", {
    account: activeAccount,
    mailboxHash: mailbox.hash,
    messages: policy,
  });

  if (currentTabLevelParentHash && !mailboxes.some((m) => m.hash === currentTabLevelParentHash)) {
    currentTabLevelParentHash = null;
  }
  if (!mailboxes.some((m) => m.hash === currentMailboxHash)) {
    const inbox = mailboxes.find((m) => m.special_usage === "Inbox") ?? mailboxes[0];
    currentMailboxHash = inbox ? inbox.hash : null;
    showEmptyReadingPane();
    renderMailboxTabs();
    if (currentMailboxHash) await loadMessages();
    return;
  }
  renderMailboxTabs();
}

async function markAllRead(mailbox) {
  try {
    await invoke("mark_all_seen", { account: activeAccount, mailboxHash: mailbox.hash });
  } catch (err) {
    console.error("mark_all_seen failed", err);
    showErrorToast(`Couldn't mark all as read: ${err}`);
    return;
  }

  const cached = mailboxMessagesCache.get(mailboxCacheKey(activeAccount, mailbox.hash));
  if (cached) {
    for (const row of cached) row.is_seen = true;
    persistMailboxMessagesCache();
  }
  adjustMailboxCounts(mailbox.hash, 0, -mailbox.unread);
  renderMailboxTabs();
  if (currentMailboxHash === mailbox.hash) {
    if (cached) renderMessageRows(cached);
    else await loadMessages();
  }
}

async function markAllReadUnified(category) {
  const contributors = unifiedContributingMailboxes(category);
  const failed = [];
  await Promise.all(
    contributors.map(async ({ account, mailbox }) => {
      try {
        await invoke("mark_all_seen", { account, mailboxHash: mailbox.hash });
        const cached = mailboxMessagesCache.get(mailboxCacheKey(account, mailbox.hash));
        if (cached) {
          for (const row of cached) row.is_seen = true;
        }
        mailbox.unread = 0;
      } catch (err) {
        console.error(`mark_all_seen failed for ${account}/${mailbox.name}`, err);
        failed.push(`${mailbox.name} (${account})`);
      }
    }),
  );
  persistMailboxMessagesCache();
  renderUnifiedTabs();
  if (currentUnifiedCategory === category) {
    const merged = [];
    for (const { account, mailbox } of contributors) {
      merged.push(...(mailboxMessagesCache.get(mailboxCacheKey(account, mailbox.hash)) ?? []));
    }
    renderUnifiedRows(merged.sort((a, b) => b.date - a.date));
  }
  if (failed.length > 0) {
    showErrorToast(
      failed.length === 1 ? `Couldn't mark all as read in ${failed[0]}` : `Couldn't mark all as read in ${failed.length} mailboxes`,
    );
  }
}

let emptyMailboxTarget = null;

function openEmptyMailboxModal(mailbox, unifiedCategory = null) {
  if (unifiedCategory) {
    const contributors = unifiedContributingMailboxes(unifiedCategory);
    const total = contributors.reduce((sum, c) => sum + c.mailbox.total, 0);
    const label = contributors[0]?.mailbox.name ?? unifiedCategory;
    emptyMailboxTarget = { unifiedCategory, contributors };
    emptyMailboxTitleEl.textContent = `Delete all messages in ${label}`;
    emptyMailboxSummaryEl.textContent =
      total > 0
        ? `This permanently deletes all ${total} message${total === 1 ? "" : "s"} across every account's "${label}". This can't be undone.`
        : `"${label}" is already empty.`;
  } else {
    emptyMailboxTarget = { mailbox };
    emptyMailboxTitleEl.textContent = `Delete all messages in ${mailbox.name}`;
    emptyMailboxSummaryEl.textContent =
      mailbox.total > 0
        ? `This permanently deletes all ${mailbox.total} message${mailbox.total === 1 ? "" : "s"} in "${mailbox.name}". This can't be undone.`
        : `"${mailbox.name}" is already empty.`;
  }
  emptyMailboxErrorEl.textContent = "";
  emptyMailboxOverlayEl.hidden = false;
}

function closeEmptyMailboxModal() {
  emptyMailboxOverlayEl.hidden = true;
  emptyMailboxTarget = null;
}

document.getElementById("empty-mailbox-cancel").addEventListener("click", closeEmptyMailboxModal);
document.getElementById("empty-mailbox-close").addEventListener("click", closeEmptyMailboxModal);
emptyMailboxOverlayEl.addEventListener("click", (e) => {
  if (e.target === emptyMailboxOverlayEl) closeEmptyMailboxModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !emptyMailboxOverlayEl.hidden) closeEmptyMailboxModal();
});

emptyMailboxFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const target = emptyMailboxTarget;
  if (!target) return;
  emptyMailboxErrorEl.textContent = "";
  emptyMailboxConfirmEl.disabled = true;
  emptyMailboxConfirmEl.textContent = "Deleting…";
  try {
    if (target.unifiedCategory) {
      const failed = [];
      await Promise.all(
        target.contributors.map(({ account, mailbox }) =>
          invoke("delete_all_messages", { account, mailboxHash: mailbox.hash })
            .then(() => {
              mailboxMessagesCache.set(mailboxCacheKey(account, mailbox.hash), []);
              mailbox.total = 0;
              mailbox.unread = 0;
            })
            .catch((err) => {
              console.error(`delete_all_messages failed for ${account}/${mailbox.name}`, err);
              failed.push(`${mailbox.name} (${account}): ${err}`);
            }),
        ),
      );
      persistMailboxMessagesCache();
      renderUnifiedTabs();
      if (currentUnifiedCategory === target.unifiedCategory) {
        renderUnifiedRows([]);
      }
      if (failed.length > 0) {
        throw new Error(failed.join("; "));
      }
    } else {
      const mailbox = target.mailbox;
      await invoke("delete_all_messages", { account: activeAccount, mailboxHash: mailbox.hash });

      mailboxMessagesCache.set(mailboxCacheKey(activeAccount, mailbox.hash), []);
      persistMailboxMessagesCache();
      adjustMailboxCounts(mailbox.hash, -mailbox.total, -mailbox.unread);
      renderMailboxTabs();
      if (currentMailboxHash === mailbox.hash) {
        renderMessageRows([]);
      }
    }
    closeEmptyMailboxModal();
  } catch (err) {
    emptyMailboxErrorEl.textContent = `${err}`;
  } finally {
    emptyMailboxConfirmEl.disabled = false;
    emptyMailboxConfirmEl.textContent = "Delete all messages";
  }
});

async function deleteMailboxTab(mailbox) {
  const { descendantHashes, totalMessages } = computeMailboxDeletionImpact(mailbox);
  if (totalMessages === 0 && descendantHashes.length === 0) {
    if (!confirm(`Delete folder "${mailbox.name}"?`)) return;
    try {
      await performMailboxDeletion(mailbox, "move_to_parent");
    } catch (err) {
      alert(`Could not delete folder: ${err}`);
    }
    return;
  }
  openDeleteMailboxModal(mailbox, descendantHashes, totalMessages);
}

let mailboxManagePanelEl = null;

function buildMailboxManageNode(mailbox, hidden) {
  const node = document.createElement("div");
  node.className = "mailbox-manage-node";
  node.dataset.hash = mailbox.hash;

  const row = document.createElement("div");
  row.className = "mailbox-manage-row";

  const children = effectiveChildren(mailbox.hash);
  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.className = "mailbox-manage-chevron";
  if (children.length > 0) {
    chevron.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      node.classList.toggle("expanded");
    });
  } else {
    chevron.disabled = true;
    chevron.style.visibility = "hidden";
  }
  row.appendChild(chevron);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "mailbox-manage-checkbox";
  checkbox.checked = !hidden.has(mailbox.hash);
  row.appendChild(checkbox);

  const label = document.createElement("label");
  label.className = "mailbox-manage-name";
  label.textContent = mailbox.name;
  label.addEventListener("click", (e) => {
    e.stopPropagation();
    checkbox.click();
  });
  row.appendChild(label);

  node.appendChild(row);

  const childrenEl = document.createElement("div");
  childrenEl.className = "mailbox-manage-children";
  for (const child of children) {
    childrenEl.appendChild(buildMailboxManageNode(child, hidden));
  }
  node.appendChild(childrenEl);

  checkbox.addEventListener("change", () => {
    const current = getHiddenMailboxes();
    const descendants = allDescendantHashes(mailbox.hash);
    const ancestors = ancestorHashes(mailbox.hash);
    for (const hash of [mailbox.hash, ...descendants]) {
      if (checkbox.checked) {
        current.delete(hash);
      } else {
        current.add(hash);
      }
    }
    if (checkbox.checked) {
      for (const ancestorHash of ancestors) current.delete(ancestorHash);
    }
    setHiddenMailboxes(current);

    for (const childNode of childrenEl.querySelectorAll(".mailbox-manage-node")) {
      const childCheckbox = childNode.querySelector(":scope > .mailbox-manage-row > .mailbox-manage-checkbox");
      childCheckbox.checked = checkbox.checked;
      childCheckbox.indeterminate = false;
    }

    if (checkbox.checked) {
      const panelEl = node.closest(".mailbox-manage-panel");
      for (const ancestorHash of ancestors) {
        const ancestorCheckbox = panelEl.querySelector(
          `.mailbox-manage-node[data-hash="${ancestorHash}"] > .mailbox-manage-row > .mailbox-manage-checkbox`,
        );
        if (ancestorCheckbox) ancestorCheckbox.checked = true;
      }
    }
    checkbox.indeterminate = false;

    let root = node;
    while (root.parentElement?.closest(".mailbox-manage-node")) {
      root = root.parentElement.closest(".mailbox-manage-node");
    }
    refreshIndeterminateStates(root);

    const affected = [mailbox.hash, ...descendants];
    if (!checkbox.checked && affected.includes(currentMailboxHash)) {
      closeMailboxManagePanel();
      const fallback = mailboxes.find(
        (m) => !affected.includes(m.hash) && !current.has(m.hash),
      );
      if (fallback) switchMailbox(fallback.hash);
    }
  });

  return node;
}

function refreshIndeterminateStates(node) {
  const childrenEl = node.querySelector(":scope > .mailbox-manage-children");
  const childNodes = [...childrenEl.children];
  for (const child of childNodes) refreshIndeterminateStates(child);
  if (childNodes.length === 0) return;
  const allChecked = childNodes.every((child) => subtreeAllMatch(child, true));
  const allUnchecked = childNodes.every((child) => subtreeAllMatch(child, false));
  const checkbox = node.querySelector(":scope > .mailbox-manage-row > .mailbox-manage-checkbox");
  checkbox.indeterminate = !allChecked && !allUnchecked;
}

function subtreeAllMatch(node, value) {
  const checkbox = node.querySelector(":scope > .mailbox-manage-row > .mailbox-manage-checkbox");
  if (checkbox.checked !== value) return false;
  const childrenEl = node.querySelector(":scope > .mailbox-manage-children");
  return [...childrenEl.children].every((child) => subtreeAllMatch(child, value));
}

async function toggleMailboxManagePanel() {
  if (mailboxManagePanelEl) {
    closeMailboxManagePanel();
    return;
  }

  const panel = document.createElement("div");
  panel.className = "mailbox-manage-panel";
  panel.textContent = "Loading…";
  mailboxManagePanelEl = panel;
  mailboxTabsEl.appendChild(panel);

  try {
    mailboxes = await invoke("refresh_mailboxes", { account: activeAccount });
  } catch (err) {
    panel.textContent = `error: ${err}`;
    return;
  }
  if (mailboxManagePanelEl !== panel) return;
  panel.textContent = "";

  const hidden = getHiddenMailboxes();
  const roots = orderedMailboxes().filter(isEffectivelyTopLevel);
  for (const mailbox of roots) {
    panel.appendChild(buildMailboxManageNode(mailbox, hidden));
  }
  for (const rootEl of panel.children) refreshIndeterminateStates(rootEl);

  // Listener registration delayed to the next tick to avoid the opening click immediately triggering a close
  setTimeout(() => document.addEventListener("click", closeMailboxManagePanelOnOutsideClick), 0);
}

function closeMailboxManagePanel() {
  if (!mailboxManagePanelEl) return;
  mailboxManagePanelEl.remove();
  mailboxManagePanelEl = null;
  document.removeEventListener("click", closeMailboxManagePanelOnOutsideClick);
  renderMailboxTabs();
}

function closeMailboxManagePanelOnOutsideClick(e) {
  if (mailboxManagePanelEl && !mailboxManagePanelEl.contains(e.target)) {
    closeMailboxManagePanel();
  }
}


// Built into a right-aligned wrapper alongside the gear/manage-folders
// button (mailbox-tabs-right has margin-left:auto - the gear itself no
// longer does, so it travels together with this instead of the indicator
// getting stranded next to the last tab while the gear alone jumps to the
// far edge). Both renderMailboxTabs() and renderUnifiedTabs() clear
// #mailbox-tabs's innerHTML on every call, so this is rebuilt each time
// rather than existing as a standalone persistent element.
function buildUpdateIndicator() {
  if (!availableUpdate) return null;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "update-indicator";
  btn.title = `Update Available: v${availableUpdate.version}`;
  btn.textContent = `Update Available: v${availableUpdate.version}`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openUpdateModal();
  });
  return btn;
}

// Per-distro update snippets - kept in sync by hand with the equivalent
// README sections (see packaging/deb, packaging/rpm, packaging/arch), since
// there's no shared templating between the two. Each does a fresh clone
// into /tmp rather than assuming an existing checkout location/state.
const UPDATE_SNIPPETS = {
  arch: `git clone https://github.com/daviesjamesdaniel/tarw.git /tmp/tarw-update
cd /tmp/tarw-update/packaging/arch
makepkg -si`,
  debian: `git clone https://github.com/daviesjamesdaniel/tarw.git /tmp/tarw-update
cd /tmp/tarw-update
cargo install cargo-deb --locked
cd src-tauri
cargo deb --locked
sudo apt install ./target/debian/tarw_*.deb`,
  fedora: `git clone https://github.com/daviesjamesdaniel/tarw.git /tmp/tarw-update
cd /tmp/tarw-update
cargo install cargo-generate-rpm --locked
cd src-tauri
cargo build --release --locked
cargo generate-rpm
sudo dnf install ./target/generate-rpm/tarw-*.rpm`,
};

let updateModalDistro = "arch";

function renderUpdateModalSnippet() {
  const modal = document.getElementById("update-modal-overlay");
  modal.querySelectorAll(".update-distro-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.distro === updateModalDistro);
  });
  document.getElementById("update-modal-snippet").textContent = UPDATE_SNIPPETS[updateModalDistro];
}

function openUpdateModal() {
  closeSettingsPanel();
  if (!availableUpdate) return;
  document.getElementById("update-modal-version").textContent = `v${availableUpdate.version}`;
  const notesEl = document.getElementById("update-modal-notes");
  const notes = (availableUpdate.notes || "").trim();
  notesEl.hidden = notes.length === 0;
  // textContent, not innerHTML - release notes come from GitHub's API and
  // are untrusted text, not markup to render.
  notesEl.textContent = notes;
  renderUpdateModalSnippet();
  document.getElementById("update-modal-overlay").hidden = false;
}

function closeUpdateModal() {
  document.getElementById("update-modal-overlay").hidden = true;
}

document.getElementById("update-modal-close").addEventListener("click", closeUpdateModal);
document.getElementById("update-modal-done").addEventListener("click", closeUpdateModal);
document.getElementById("update-modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "update-modal-overlay") closeUpdateModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("update-modal-overlay").hidden) closeUpdateModal();
});
document.querySelectorAll(".update-distro-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    updateModalDistro = tab.dataset.distro;
    renderUpdateModalSnippet();
  });
});
document.getElementById("update-modal-copy").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const text = UPDATE_SNIPPETS[updateModalDistro];
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API can be unreliable in this WebKitGTK setup (same family
    // of quirk as window.confirm() elsewhere) - fall back to a hidden
    // textarea + execCommand, which works even when the async API throws.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const original = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
});

let settingsPanelEl = null;

async function toggleSettingsPanel() {
  if (settingsPanelEl) {
    closeSettingsPanel();
    return;
  }
  const panel = document.createElement("div");
  panel.className = "settings-panel";
  panel.innerHTML = `<div class="settings-panel-heading-row">
      <span class="settings-panel-heading">Accounts</span>
      <button type="button" class="settings-panel-icon-button" id="settings-add-account" title="Add account" aria-label="Add account">${ICONS.plusCircle}</button>
    </div>
    <div class="settings-panel-account-list" id="settings-account-list"></div>
    <div class="settings-panel-footer">
      <span class="settings-panel-version">${currentAppVersion ? `v${escapeHtml(currentAppVersion)}` : ""}</span>
      <a href="https://buymeacoffee.com/tarw" class="settings-panel-coffee-link" title="Buy me a coffee" aria-label="Buy me a coffee">${ICONS.coffee}</a>
    </div>`;
  settingsPanelEl = panel;
  document.querySelector(".titlebar-left").appendChild(panel);

  const addAccountBtn = panel.querySelector("#settings-add-account");
  addAccountBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openAddAccountModal();
  });

  const listEl = panel.querySelector("#settings-account-list");
  let accountList = [];
  try {
    accountList = await invoke("list_accounts");
  } catch (err) {
    console.error("list_accounts failed", err);
    showErrorToast(`Couldn't load accounts: ${err}`);
  }
  if (settingsPanelEl !== panel) return;
  renderSettingsAccountRows(listEl, accountList);

  // Listener registration delayed to the next tick to avoid the opening click immediately triggering a close
  setTimeout(() => document.addEventListener("click", closeSettingsPanelOnOutsideClick), 0);
}

function buildToggleRow(label, checked, onToggle, extraClass) {
  const row = document.createElement("div");
  row.className = "settings-panel-account-row" + (extraClass ? ` ${extraClass}` : "") + (checked ? " active" : "");
  row.innerHTML = `<span class="settings-panel-account-email">${escapeHtml(label)}</span>
    <button type="button" class="toggle-switch" role="switch" aria-checked="${checked}" aria-label="${escapeHtml(label)}"></button>`;
  row.addEventListener("click", () => onToggle());
  row.querySelector(".toggle-switch").addEventListener("click", (e) => {
    e.stopPropagation();
    onToggle();
  });
  return row;
}

function renderSettingsAccountRows(container, accountList) {
  if (accountList.length === 0) {
    container.innerHTML = `<div class="settings-panel-account-row">
      <span class="settings-panel-account-email settings-panel-account-empty">No account signed in</span>
    </div>`;
    return;
  }
  container.innerHTML = "";

  container.appendChild(
    buildToggleRow("Unified Inbox", unifiedActive, toggleUnifiedInbox, "settings-panel-unified-row"),
  );

  container.appendChild(
    buildToggleRow("Threaded", threadViewEnabled, toggleThreadView, "settings-panel-unified-row"),
  );

  if (unifiedActive) {
    container.appendChild(
      buildToggleRow("Show account labels", showAccountPills, toggleAccountPills, "settings-panel-unified-row"),
    );
  }

  for (const acct of accountList) {
    const row = document.createElement("div");
    row.className = "settings-panel-account-row";
    if (!unifiedActive && acct.email === activeAccount) row.classList.add("active");
    row.innerHTML = `<span class="settings-panel-account-email">${escapeHtml(acct.email)}</span>
      <button type="button" class="settings-panel-icon-button settings-edit-account" title="Edit account" aria-label="Edit account">${ICONS.pencil}</button>
      <button type="button" class="settings-panel-icon-button settings-panel-icon-button-danger settings-remove-account" title="Remove account" aria-label="Remove account">${ICONS.delete}</button>`;
    row.addEventListener("click", () => {
      closeSettingsPanel();
      switchAccount(acct.email);
    });

    row.querySelector(".settings-edit-account").addEventListener("click", (e) => {
      e.stopPropagation();
      openEditAccountModal(acct);
    });
    row.querySelector(".settings-remove-account").addEventListener("click", (e) => {
      e.stopPropagation();
      openRemoveAccountModal(acct.email);
    });
    container.appendChild(row);
  }
}

async function switchAccount(email) {
  const wasViewingSearch = !searchResultsEl.hidden;
  const alreadyThere = !unifiedActive && email === activeAccount && !wasViewingSearch;
  unifiedActive = false;
  localStorage.setItem("unifiedActive", "");
  if (alreadyThere) return;
  activeAccount = email;
  localStorage.setItem("activeAccount", email);
  hasAccount = true;
  currentMailboxHash = null;
  if (wasViewingSearch) hideSearchGrid();
  await loadMailboxes();
}

function closeSettingsPanel() {
  if (!settingsPanelEl) return;
  settingsPanelEl.remove();
  settingsPanelEl = null;
  document.removeEventListener("click", closeSettingsPanelOnOutsideClick);
}

function closeSettingsPanelOnOutsideClick(e) {
  if (settingsPanelEl && !settingsPanelEl.contains(e.target)) {
    closeSettingsPanel();
  }
}

function openRemoveAccountModal(email) {
  closeSettingsPanel();
  pendingRemoveEmail = email;
  removeAccountTargetEl.textContent = email;
  removeAccountErrorEl.textContent = "";
  removeAccountOverlayEl.hidden = false;
}

function closeRemoveAccountModal() {
  removeAccountOverlayEl.hidden = true;
  pendingRemoveEmail = null;
}

document.getElementById("remove-account-cancel").addEventListener("click", closeRemoveAccountModal);
document.getElementById("remove-account-close").addEventListener("click", closeRemoveAccountModal);
removeAccountOverlayEl.addEventListener("click", (e) => {
  if (e.target === removeAccountOverlayEl) closeRemoveAccountModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !removeAccountOverlayEl.hidden) closeRemoveAccountModal();
});

removeAccountFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = pendingRemoveEmail;
  removeAccountErrorEl.textContent = "";
  removeAccountConfirmEl.disabled = true;
  removeAccountConfirmEl.textContent = "Removing…";
  try {
    await invoke("remove_account", { email });
    await purgeAccountCaches(email);
    closeRemoveAccountModal();
    const remaining = await invoke("list_accounts");
    if (remaining.length === 0) {
      resetToSignedOutState();
    } else if (unifiedActive && unifiedAccounts.includes(email)) {
      await activateUnifiedMode();
    } else if (email === activeAccount) {
      activeAccount = "";
      await switchAccount(remaining[0].email);
    }
  } catch (err) {
    removeAccountErrorEl.textContent = `${err}`;
  } finally {
    removeAccountConfirmEl.disabled = false;
    removeAccountConfirmEl.textContent = "Remove account";
  }
});

let detectedAddAccountProvider = null;
let addAccountOAuthInFlightEmail = null;
let addAccountStep = "email";
let addAccountIsEditing = false;

function openAddAccountModal() {
  closeSettingsPanel();
  addAccountFormEl.reset();
  addAccountErrorEl.textContent = "";
  addAccountTitleEl.textContent = "Add account";
  addAccountIsEditing = false;
  detectedAddAccountProvider = null;
  addAccountDetectedForEmail = null;
  addAccountDetectPromise = null;
  addAccountOAuthInFlightEmail = null;
  addAccountStep = "email";
  addAccountEmailEl.disabled = false;
  addAccountManualHostFieldsEl.hidden = true;
  addAccountPasswordFieldEl.hidden = true;
  addAccountStatusEl.hidden = true;
  addAccountSendEl.textContent = "Continue";
  addAccountOverlayEl.hidden = false;
  addAccountEmailEl.focus();
}

// Reuses the add-account modal/backend wholesale rather than a separate edit
// flow: accounts::add() (Rust) already upserts by email, so submitting this
// modal for an existing account just replaces its provider/credentials and
// reconnects - no new backend command needed beyond looking the builtin
// provider config back up by id (detect_provider works from an email domain,
// not helpful here since the account's own domain may not match its id).
async function openEditAccountModal(acct) {
  closeSettingsPanel();
  addAccountFormEl.reset();
  addAccountErrorEl.textContent = "";
  addAccountTitleEl.textContent = "Edit account";
  addAccountIsEditing = true;
  addAccountOAuthInFlightEmail = null;
  addAccountEmailEl.value = acct.email;
  addAccountEmailEl.disabled = true;
  addAccountStatusEl.hidden = true;
  addAccountStep = "credentials";
  addAccountOverlayEl.hidden = false;

  if (acct.provider.kind === "builtin") {
    try {
      detectedAddAccountProvider = await invoke("provider_by_id", { id: acct.provider.id });
    } catch (err) {
      addAccountErrorEl.textContent = `${err}`;
      detectedAddAccountProvider = null;
    }
  } else {
    detectedAddAccountProvider = null;
  }

  if (detectedAddAccountProvider && detectedAddAccountProvider.auth_method === "o_auth2") {
    addAccountManualHostFieldsEl.hidden = true;
    addAccountPasswordFieldEl.hidden = true;
    addAccountSendEl.textContent = "Re-authenticate";
  } else if (detectedAddAccountProvider) {
    // Builtin password provider (Fastmail/iCloud) - host/port are fixed by
    // the provider config, only the password can actually change.
    addAccountManualHostFieldsEl.hidden = true;
    addAccountPasswordFieldEl.hidden = false;
    addAccountSendEl.textContent = "Save";
    addAccountPasswordEl.focus();
  } else {
    addAccountManualHostFieldsEl.hidden = false;
    addAccountPasswordFieldEl.hidden = false;
    addAccountImapHostEl.value = acct.provider.imap_host;
    addAccountImapPortEl.value = acct.provider.imap_port;
    addAccountSmtpHostEl.value = acct.provider.smtp_host;
    addAccountSmtpPortEl.value = acct.provider.smtp_port;
    addAccountSendEl.textContent = "Save";
    addAccountImapHostEl.focus();
  }
}

function closeAddAccountModal() {
  if (addAccountOAuthInFlightEmail) {
    invoke("cancel_oauth_login", { email: addAccountOAuthInFlightEmail }).catch((err) => {
      console.error("cancel_oauth_login failed", err);
    });
    addAccountOAuthInFlightEmail = null;
  }
  addAccountOverlayEl.hidden = true;
}

document.getElementById("add-account-cancel").addEventListener("click", closeAddAccountModal);
document.getElementById("add-account-close").addEventListener("click", closeAddAccountModal);
addAccountOverlayEl.addEventListener("click", (e) => {
  if (e.target === addAccountOverlayEl) closeAddAccountModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !addAccountOverlayEl.hidden) closeAddAccountModal();
});

let addAccountDetectedForEmail = null;
let addAccountDetectPromise = null;

function ensureProviderDetected(email) {
  if (addAccountDetectedForEmail === email && addAccountDetectPromise) {
    return addAccountDetectPromise;
  }
  addAccountDetectedForEmail = email;
  addAccountDetectPromise = invoke("detect_provider", { email }).catch((err) => {
    console.error("detect_provider failed", err);
    return null;
  });
  return addAccountDetectPromise;
}

async function performAddAccount(email) {
  addAccountSendEl.disabled = true;
  addAccountStatusEl.hidden = false;
  try {
    let record;
    if (detectedAddAccountProvider && detectedAddAccountProvider.auth_method === "o_auth2") {
      addAccountSendEl.textContent = "Signing in…";
      addAccountStatusTextEl.textContent = "Waiting for sign-in in your browser…";
      addAccountOAuthInFlightEmail = email;
      record = await invoke("add_account", {
        email,
        providerId: detectedAddAccountProvider.id,
        manual: null,
        password: null,
      });
    } else {
      addAccountSendEl.textContent = "Adding…";
      addAccountStatusTextEl.textContent = "Connecting…";
      const manual = detectedAddAccountProvider
        ? null
        : {
            imapHost: addAccountImapHostEl.value.trim(),
            imapPort: Number(addAccountImapPortEl.value),
            imapUseTls: true,
            smtpHost: addAccountSmtpHostEl.value.trim(),
            smtpPort: Number(addAccountSmtpPortEl.value),
            smtpUseImplicitTls: false,
          };
      record = await invoke("add_account", {
        email,
        providerId: detectedAddAccountProvider ? detectedAddAccountProvider.id : null,
        manual,
        password: addAccountPasswordEl.value,
      });
    }
    closeAddAccountModal();
    activeAccount = "";
    await switchAccount(record.email);
  } catch (err) {
    addAccountErrorEl.textContent = `${err}`;
  } finally {
    addAccountOAuthInFlightEmail = null;
    addAccountSendEl.disabled = false;
    addAccountStatusEl.hidden = true;
    const isOAuth = detectedAddAccountProvider && detectedAddAccountProvider.auth_method === "o_auth2";
    addAccountSendEl.textContent = addAccountIsEditing ? (isOAuth ? "Re-authenticate" : "Save") : isOAuth ? "Sign in" : "Add account";
  }
}

addAccountFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = addAccountEmailEl.value.trim();
  addAccountErrorEl.textContent = "";

  if (addAccountStep === "email") {
    addAccountSendEl.disabled = true;
    addAccountStatusEl.hidden = false;
    addAccountStatusTextEl.textContent = "Checking provider…";
    try {
      detectedAddAccountProvider = await ensureProviderDetected(email);
    } catch (err) {
      addAccountErrorEl.textContent = `${err}`;
      addAccountSendEl.disabled = false;
      addAccountStatusEl.hidden = true;
      return;
    }
    addAccountStep = "credentials";
    addAccountEmailEl.disabled = true;

    if (detectedAddAccountProvider && detectedAddAccountProvider.auth_method === "o_auth2") {
      // Nothing extra to collect for OAuth - go straight into signing in
      // rather than making the user click a second time. Safe to continue
      // synchronously here (unlike doing this from a *new* click) since
      // we're still inside the same click's handler, not racing a
      // follow-up mousedown/mouseup against a layout change.
      addAccountManualHostFieldsEl.hidden = true;
      addAccountPasswordFieldEl.hidden = true;
      await performAddAccount(email);
      return;
    }

    addAccountSendEl.disabled = false;
    addAccountStatusEl.hidden = true;
    if (detectedAddAccountProvider) {
      addAccountManualHostFieldsEl.hidden = true;
      addAccountPasswordFieldEl.hidden = false;
      addAccountSendEl.textContent = "Add account";
      addAccountPasswordEl.focus();
    } else {
      // Unknown domain: full manual entry.
      addAccountManualHostFieldsEl.hidden = false;
      addAccountPasswordFieldEl.hidden = false;
      addAccountSendEl.textContent = "Add account";
      addAccountImapHostEl.focus();
    }
    return;
  }

  await performAddAccount(email);
});

function syncCurrentMailboxUnreadBadge() {
  const mailbox = mailboxes.find((m) => m.hash === currentMailboxHash);
  if (mailbox) mailbox.unread = currentMailboxOwnUnread;
  const tab = mailboxTabsEl.querySelector(".mailbox-tab.active");
  if (!tab) return;
  const existingBadge = tab.querySelector(".mailbox-tab-badge");
  const badgeCount = mailbox ? mailboxBadgeCount(mailbox) : 0;
  if (badgeCount > 0) {
    if (existingBadge) {
      existingBadge.textContent = badgeCount;
    } else {
      const badge = document.createElement("span");
      badge.className = "mailbox-tab-badge";
      badge.textContent = badgeCount;
      tab.appendChild(badge);
    }
  } else if (existingBadge) {
    existingBadge.remove();
  }
}

function isCurrentMailboxInbox() {
  if (unifiedActive) return currentUnifiedCategory === "Inbox";
  return mailboxes.find((m) => m.hash === currentMailboxHash)?.special_usage === "Inbox";
}

async function switchMailbox(hash) {
  const wasViewingSearch = !searchResultsEl.hidden;
  if (hash === currentMailboxHash && !wasViewingSearch) return;
  currentMailboxHash = hash;
  if (wasViewingSearch) hideSearchGrid();
  showEmptyReadingPane();
  renderMailboxTabs();
  inboxListEl.scrollTop = 0;
  await loadMessages();
}

async function loadMailboxes() {
  showEmptyReadingPane();
  const targetAccount = activeAccount;

  const persistedMailboxes = mailboxesByAccount[targetAccount];
  let paintedFromCache = false;
  if (persistedMailboxes && persistedMailboxes.length > 0) {
    mailboxes = persistedMailboxes;
    const hidden = getHiddenMailboxes();
    const visible = persistedMailboxes.filter((m) => !hidden.has(m.hash));
    const inbox = visible.find((m) => m.special_usage === "Inbox") ?? visible[0] ?? persistedMailboxes[0];
    currentMailboxHash = inbox.hash;
    renderMailboxTabs();
    const cachedRows = mailboxMessagesCache.get(mailboxCacheKey(targetAccount, currentMailboxHash));
    if (cachedRows) {
      showEmptyReadingPane();
      renderMessageRows(cachedRows);
      paintedFromCache = true;
    }
  }

  if (!paintedFromCache) statusEl.textContent = "Connecting…";
  try {
    mailboxes = await invoke("fetch_mailboxes", { account: targetAccount });
    if (activeAccount !== targetAccount) return;
    mailboxesByAccount[targetAccount] = mailboxes;
    persistMailboxesByAccount();
    if (mailboxes.length === 0) {
      statusEl.textContent = "No folders found";
      return;
    }
    const hidden = getHiddenMailboxes();
    const visible = mailboxes.filter((m) => !hidden.has(m.hash));
    const inbox =
      visible.find((m) => m.special_usage === "Inbox") ??
      visible[0] ??
      mailboxes[0];
    currentMailboxHash = inbox.hash;
    renderMailboxTabs();
    await loadMessages();
    // Delayed so badge-priming doesn't compete for connection-pool slots with the visible mailbox loading
    setTimeout(() => primeMailboxBadges(targetAccount, visible, inbox.hash), 2000);
  } catch (err) {
    if (activeAccount !== targetAccount) return;
    if (paintedFromCache) {
      showErrorToast(`Couldn't refresh folders: ${err}`);
    } else {
      statusEl.textContent = `error: ${err}`;
    }
    scheduleStatusRetry(loadMailboxes);
  }
}

async function primeMailboxBadges(account, topLevel, alreadyLoadedHash) {
  const failed = [];
  await Promise.all(
    topLevel
      .filter((m) => m.hash !== alreadyLoadedHash)
      .map(async (mailbox) => {
        try {
          const rows = await invoke("fetch_mailbox_messages", { account, mailboxHash: mailbox.hash });
          mailbox.total = rows.length;
          mailbox.unread = rows.filter((r) => !r.is_seen).length;
          renderMailboxTabs();
          mailboxMessagesCache.set(mailboxCacheKey(account, mailbox.hash), rows);
          persistMailboxMessagesCache();
          indexRowsIntoAddressBook(rows, mailbox);
        } catch (err) {
          console.error(`priming badge for ${account}/${mailbox.name} failed`, err);
          failed.push(mailbox.name);
        }
      }),
  );
  if (failed.length > 0) {
    showErrorToast(
      failed.length === 1 ? `Couldn't refresh ${failed[0]}'s count` : `Couldn't refresh ${failed.length} tabs' counts`,
    );
  }
}

const mailboxMessagesCache = new Map();
function mailboxCacheKey(account, mailboxHash) {
  return `${account}::${mailboxHash}`;
}

let persistMailboxMessagesCacheTimer = null;
// Debounced so rapid successive calls (e.g. several IDLE pushes in a row) only serialize and write the cache once
function persistMailboxMessagesCache() {
  if (persistMailboxMessagesCacheTimer) return;
  persistMailboxMessagesCacheTimer = setTimeout(() => {
    persistMailboxMessagesCacheTimer = null;
    try {
      localStorage.setItem("mailboxMessagesCache", JSON.stringify([...mailboxMessagesCache]));
    } catch (err) {
      console.error("Failed to persist mailboxMessagesCache", err);
    }
  }, 300);
}
function loadPersistedMailboxMessagesCache() {
  try {
    const raw = localStorage.getItem("mailboxMessagesCache");
    if (!raw) return;
    for (const [key, rows] of JSON.parse(raw)) {
      mailboxMessagesCache.set(key, rows);
    }
  } catch {
  }
}
function persistMailboxesByAccount() {
  try {
    localStorage.setItem("mailboxesByAccount", JSON.stringify(mailboxesByAccount));
  } catch {
  }
}
function loadPersistedMailboxesByAccount() {
  try {
    const raw = localStorage.getItem("mailboxesByAccount");
    if (raw) Object.assign(mailboxesByAccount, JSON.parse(raw));
  } catch {
  }
}
loadPersistedMailboxMessagesCache();
loadPersistedMailboxesByAccount();

const recipientAddressBook = new Map();

function parseAddressEntry(entry) {
  const match = /^(.*)<([^<>]+)>\s*$/.exec(entry.trim());
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "");
    const address = match[2].trim();
    return address ? { name, address } : null;
  }
  const address = entry.trim();
  return address ? { name: "", address } : null;
}

// We don't want 'NOREPLY' email addresses to be presented to the user as
// potential recipients when composing
const NOREPLY_ADDRESS_PATTERN = /^(no-?reply|do-?not-?reply)@/i;

function indexAddressBookEntry(name, address, date) {
  if (!address) return;
  if (NOREPLY_ADDRESS_PATTERN.test(address)) return;
  const key = address.toLowerCase();
  const existing = recipientAddressBook.get(key);
  if (existing) {
    existing.count += 1;
    if (date > existing.lastSeen) existing.lastSeen = date;
    if (!existing.name && name) existing.name = name;
  } else {
    recipientAddressBook.set(key, { name, address, count: 1, lastSeen: date });
  }
}

// The same rows can legitimately pass through indexRowsIntoAddressBook more than once
// we therefore need to track every hash that has been processed already
const indexedRowHashes = new Set();

// Only index potential recipient addresses from Inbox and Sent
function indexRowsIntoAddressBook(rows, mailbox) {
  if (mailbox && mailbox.special_usage !== "Inbox" && mailbox.special_usage !== "Sent") return;
  // Wrapped to ensure that the indexing doesn't lock us from painting
  setTimeout(() => {
    for (const row of rows) {
      if (indexedRowHashes.has(row.hash)) continue;
      indexedRowHashes.add(row.hash);
      indexAddressBookEntry(row.from, row.from_address, row.date);
      for (const entry of row.to ?? []) {
        const parsed = parseAddressEntry(entry);
        if (parsed) indexAddressBookEntry(parsed.name, parsed.address, row.date);
      }
      for (const entry of row.cc ?? []) {
        const parsed = parseAddressEntry(entry);
        if (parsed) indexAddressBookEntry(parsed.name, parsed.address, row.date);
      }
    }
  }, 0);
}

for (const [key, rows] of mailboxMessagesCache) {
  const [account, mailboxHashStr] = key.split("::");
  const mailbox = (mailboxesByAccount[account] ?? []).find((m) => String(m.hash) === mailboxHashStr);
  indexRowsIntoAddressBook(rows, mailbox);
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
  // Delay hide by a tick so the suggestion's click-handler has finished before blur clears it
  inputEl.addEventListener("blur", () => setTimeout(hide, 0));
}

const messageBodyCache = new Map();
const MESSAGE_BODY_DISK_CACHE_LIMIT = 40;
function bodyCacheKey(account, hash) {
  return `${account}::${hash}`;
}
function fetchBodyCached(account, hash) {
  const key = bodyCacheKey(account, hash);
  const cached = messageBodyCache.get(key);
  if (cached) return cached;
  const promise = invoke("fetch_body", { account, hash })
    .then((body) => {
      persistMessageBodyCache(key, body);
      return body;
    })
    .catch((err) => {
      messageBodyCache.delete(key);
      throw err;
    });
  messageBodyCache.set(key, promise);
  return promise;
}

// Bodies aren't persisted server-side by melib across launches, so without
// this a cold start can't open ANY email - even one just read - without
// waiting on a fresh IMAP connect/login. Cap at a fixed count (rather than
// mirroring the whole in-memory Map) since full HTML bodies are much larger
// than mailboxMessagesCache's headers-only rows and would risk blowing
// localStorage's quota.
let persistMessageBodyCacheTimer = null;
function persistMessageBodyCache(key, body) {
  if (persistMessageBodyCacheTimer) return;
  persistMessageBodyCacheTimer = setTimeout(async () => {
    persistMessageBodyCacheTimer = null;
    try {
      const resolved = [];
      for (const [k, v] of messageBodyCache) {
        try {
          resolved.push([k, await v]);
        } catch {
        }
      }
      const trimmed = resolved.slice(-MESSAGE_BODY_DISK_CACHE_LIMIT);
      localStorage.setItem("messageBodyCache", JSON.stringify(trimmed));
    } catch (err) {
      console.error("Failed to persist messageBodyCache", err);
    }
  }, 300);
}
function loadPersistedMessageBodyCache() {
  try {
    const raw = localStorage.getItem("messageBodyCache");
    if (!raw) return;
    for (const [key, body] of JSON.parse(raw)) {
      messageBodyCache.set(key, Promise.resolve(body));
    }
  } catch (err) {
    console.error("Failed to load persisted messageBodyCache", err);
  }
}
loadPersistedMessageBodyCache();

async function purgeAccountCaches(email) {
  try {
    localStorage.removeItem(`allowedRemoteImages:${email}`);
    localStorage.removeItem(`hiddenMailboxes:${email}`);
    localStorage.removeItem(`mailboxOrder:${email}`);
  } catch (err) {
    console.error("Failed to clear per-account settings after purge", err);
  }
  delete mailboxesByAccount[email];
  try {
    localStorage.setItem("mailboxesByAccount", JSON.stringify(mailboxesByAccount));
  } catch (err) {
    console.error("Failed to persist mailboxesByAccount after purge", err);
  }
  const prefix = `${email}::`;
  for (const key of [...mailboxMessagesCache.keys()]) {
    if (key.startsWith(prefix)) mailboxMessagesCache.delete(key);
  }
  for (const key of [...messageBodyCache.keys()]) {
    if (key.startsWith(prefix)) messageBodyCache.delete(key);
  }
  try {
    localStorage.setItem("mailboxMessagesCache", JSON.stringify([...mailboxMessagesCache]));
  } catch (err) {
    console.error("Failed to persist mailboxMessagesCache after purge", err);
  }
  try {
    const resolved = [];
    for (const [k, v] of messageBodyCache) {
      try {
        resolved.push([k, await v]);
      } catch {
      }
    }
    localStorage.setItem("messageBodyCache", JSON.stringify(resolved.slice(-MESSAGE_BODY_DISK_CACHE_LIMIT)));
  } catch (err) {
    console.error("Failed to persist messageBodyCache after purge", err);
  }
}

const VIRTUAL_ROW_HEIGHT_ESTIMATE = 57; 
const VIRTUAL_BUFFER_ROWS = 8; 

let virtualRows = [];
let virtualRowBuilder = null; // (row) => li
let virtualMeasuredRowHeight = null;
let virtualScrollFrameRequested = false;

// We have two spacer elements TopSpacer and BottomSpacer 
// this is to ensure that we can correctly size the window 
// without this the scrollbar would only reflect the size of the handful of rows
// rendered rather than suggesting to user that more messages off screen exist
const virtualTopSpacerEl = document.createElement("li");
virtualTopSpacerEl.className = "inbox-row-spacer";
virtualTopSpacerEl.setAttribute("aria-hidden", "true");
const virtualBottomSpacerEl = document.createElement("li");
virtualBottomSpacerEl.className = "inbox-row-spacer";
virtualBottomSpacerEl.setAttribute("aria-hidden", "true");

function setVirtualRows(rows, rowBuilder) {
  virtualRows = rows;
  virtualRowBuilder = rowBuilder;
  renderVirtualWindow();
}

function renderVirtualWindow() {
  if (!virtualRowBuilder) return;
  const rowHeight = virtualMeasuredRowHeight ?? VIRTUAL_ROW_HEIGHT_ESTIMATE;
  const total = virtualRows.length;
  const scrollTop = inboxListEl.scrollTop;
  const viewportHeight = inboxListEl.clientHeight || 600;
  // scrollTop can become stale from the last visited mailbox if you visit a 'shorter' mailbox -
  // we compute a start index too large, which would cause unnecessary spacer heights, scrollbar
  // and scroll handler flooding syscalls. We therefore clamp start to a valid range
  const start = Math.max(0, Math.min(total, Math.floor(scrollTop / rowHeight) - VIRTUAL_BUFFER_ROWS));
  const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + VIRTUAL_BUFFER_ROWS);

  listEl.innerHTML = "";
  virtualTopSpacerEl.style.height = `${start * rowHeight}px`;
  listEl.appendChild(virtualTopSpacerEl);
  for (let i = start; i < end; i++) {
    const li = virtualRowBuilder(virtualRows[i]);
    listEl.appendChild(li);
    // We have up until this point guessed at the height as nothing has been rendered
    // we need to therefore set the real row height but only do this once
    if (virtualMeasuredRowHeight === null) {
      const measured = li.getBoundingClientRect().height;
      if (measured > 0) virtualMeasuredRowHeight = measured;
    }
  }
  listEl.appendChild(virtualBottomSpacerEl);
  virtualBottomSpacerEl.style.height = `${(total - end) * rowHeight}px`;
}

// scroll events can fire dozens of times and we don't want to do a full DOM
// rebuild as this would look janky. We therefore add a simple guard flag which
// schedules a single renderVirtualWindow() on the first event, subsequent events received
// return immediately and once render runs the flag is returned to false. We are essentially
// batching and limiting the scroll event requesting too many re-renders
inboxListEl.addEventListener("scroll", () => {
  if (virtualScrollFrameRequested) return;
  virtualScrollFrameRequested = true;
  requestAnimationFrame(() => {
    virtualScrollFrameRequested = false;
    renderVirtualWindow();
  });
});

function findOrScrollToRow(hash) {
  let li = listEl.querySelector(`[data-hash="${hash}"]`) ?? pinnedListEl.querySelector(`[data-hash="${hash}"]`);
  if (li) return li;
  const index = virtualRows.findIndex((r) => r.hash === hash);
  if (index === -1) return null;
  const rowHeight = virtualMeasuredRowHeight ?? VIRTUAL_ROW_HEIGHT_ESTIMATE;
  inboxListEl.scrollTop = Math.max(0, index * rowHeight - inboxListEl.clientHeight / 2);
  renderVirtualWindow();
  return listEl.querySelector(`[data-hash="${hash}"]`);
}

function renderMessageRows(rows) {
  lastMailboxRows = rows;
  for (const row of rows) {
    row.account = activeAccount;
    row.mailboxHash = currentMailboxHash;
  }
  // Counts below are always over the full, unfiltered rows - a quick filter
  // narrows what's displayed, not the mailbox's real unread/total state.
  totalCount = rows.length;
  unreadCount = rows.filter((r) => !r.is_seen).length;
  currentMailboxOwnUnread = unreadCount;
  const currentMailbox = mailboxes.find((m) => m.hash === currentMailboxHash);
  if (currentMailbox) {
    currentMailbox.total = totalCount;
    currentMailbox.unread = unreadCount;
    const kids = descendantMailboxes(currentMailboxHash);
    totalCount += kids.reduce((sum, m) => sum + m.total, 0);
    unreadCount += kids
      .filter(mailboxTracksUnread)
      .reduce((sum, m) => sum + m.unread, 0);
  }
  updateStatus();
  renderMailboxTabs();
  const showPinnedFolder = isCurrentMailboxInbox();
  pinnedFolderEl.style.display = showPinnedFolder ? "" : "none";
  pinnedListEl.innerHTML = "";
  const canMove = hasMoveTargets(currentMailboxHash);
  const visibleRows = applyQuickFilters(rows);
  const regularRows = [];
  for (const row of visibleRows) {
    if (showPinnedFolder && row.is_flagged) {
      pinnedListEl.appendChild(buildRow(row, canMove));
    } else {
      regularRows.push(row);
    }
  }
  // Threading only ever groups the non-pinned rows above - a pinned message
  // in an otherwise-threaded conversation still shows on its own in
  // Pinned (per the user's explicit call: pin is a single-message concept,
  // not a thread-level one), so it's simply absent from its thread's count
  // here rather than double-shown.
  const displayRows = threadViewEnabled ? flattenThreads(buildThreads(regularRows)) : regularRows;
  setVirtualRows(displayRows, (row) => buildRow(row, canMove));
  updatePinnedFolderCount();
  prefetchTopBodies(visibleRows);
}

function prefetchTopBodies(rows, limit = 5) {
  // Deferred a tick so this doesn't delay the mailbox list itself from painting first
  setTimeout(() => {
    for (const row of rows.slice(0, limit)) {
      fetchBodyCached(row.account, row.hash).catch(() => {});
    }
  }, 0);
}

async function loadMessages() {
  // Deliberately doesn't clear the reading pane here - loadMessages() is
  // also called by background refreshes (the inbox-changed event, the
  // periodic poll, markAllRead, refreshMailboxView) which shouldn't close
  // whatever the user currently has open. Callers that are actually
  // navigating to a different mailbox/account clear it themselves.
  const targetAccount = activeAccount;
  const targetMailboxHash = currentMailboxHash;
  const isStillCurrent = () => activeAccount === targetAccount && currentMailboxHash === targetMailboxHash;

  const cached = mailboxMessagesCache.get(mailboxCacheKey(targetAccount, targetMailboxHash));
  if (cached) {
    renderMessageRows(cached);
  } else {
    statusEl.textContent = "Loading…";
  }

  try {
    const rows = await invoke("fetch_mailbox_messages", {
      account: targetAccount,
      mailboxHash: targetMailboxHash,
    });
    mailboxMessagesCache.set(mailboxCacheKey(targetAccount, targetMailboxHash), rows);
    persistMailboxMessagesCache();
    indexRowsIntoAddressBook(
      rows,
      (mailboxesByAccount[targetAccount] ?? []).find((m) => m.hash === targetMailboxHash),
    );
    if (!isStillCurrent()) return;
    renderMessageRows(rows);
  } catch (err) {
    if (!isStillCurrent()) return;
    if (cached) {
      showErrorToast(`Couldn't refresh this mailbox: ${err}`);
      updateStatus();
    } else {
      statusEl.textContent = `error: ${err}`;
    }
    scheduleStatusRetry(loadMessages);
  }
}

let unifiedAccounts = [];

function unifiedCategoryKey(mailbox) {
  return mailbox.special_usage === "Normal" ? `custom:${mailbox.path}` : mailbox.special_usage;
}

function renderUnifiedTabs() {
  mailboxTabsEl.innerHTML = "";
  const viewingSearch = !searchResultsEl.hidden;
  const labels = new Map(); // category key -> display label
  const badgeCounts = new Map(); // category key -> summed count
  for (const account of unifiedAccounts) {
    const hidden = getHiddenMailboxes(account);
    for (const mailbox of mailboxesByAccount[account] ?? []) {
      if (hidden.has(mailbox.hash)) continue;
      const key = unifiedCategoryKey(mailbox);
      if (!labels.has(key)) labels.set(key, mailbox.name);
      const contribution =
        mailbox.special_usage === "Drafts" ? mailbox.total : mailboxTracksUnread(mailbox) ? mailbox.unread : 0;
      badgeCounts.set(key, (badgeCounts.get(key) ?? 0) + contribution);
    }
  }
  const keys = [...labels.keys()];
  const specialKeys = keys.filter((k) => !k.startsWith("custom:") && k !== "Inbox").sort();
  const customKeys = keys
    .filter((k) => k.startsWith("custom:"))
    .sort((a, b) => labels.get(a).localeCompare(labels.get(b)));
  const ordered = ["Inbox", ...specialKeys, ...customKeys];
  for (const key of ordered) {
    if (!labels.has(key)) continue;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "mailbox-tab" + (!viewingSearch && key === currentUnifiedCategory ? " active" : "");
    const badgeCount = badgeCounts.get(key) ?? 0;
    tab.innerHTML =
      `<span class="mailbox-tab-name">${escapeHtml(labels.get(key))}</span>` +
      (badgeCount > 0 ? `<span class="mailbox-tab-badge">${badgeCount}</span>` : "");
    tab.addEventListener("click", () => switchUnifiedTab(key));
    tab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openMailboxContextMenu(e.clientX, e.clientY, null, key);
    });
    mailboxTabsEl.appendChild(tab);
  }

  appendSearchTab();

  const manageBtn = document.createElement("button");
  manageBtn.type = "button";
  manageBtn.className = "mailbox-manage-toggle";
  manageBtn.title = "Choose which folders to include, per account";
  manageBtn.innerHTML = ICONS.gear;
  manageBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleUnifiedManagePanel();
  });
  const rightGroup = document.createElement("div");
  rightGroup.className = "mailbox-tabs-right";
  const updateIndicator = buildUpdateIndicator();
  if (updateIndicator) rightGroup.appendChild(updateIndicator);
  rightGroup.appendChild(manageBtn);
  mailboxTabsEl.appendChild(rightGroup);
}

async function switchUnifiedTab(key) {
  const wasViewingSearch = !searchResultsEl.hidden;
  if (key === currentUnifiedCategory && !wasViewingSearch) return;
  currentUnifiedCategory = key;
  if (wasViewingSearch) hideSearchGrid();
  showEmptyReadingPane();
  renderUnifiedTabs();
  inboxListEl.scrollTop = 0;
  await loadUnifiedMessages();
}

function unifiedContributingMailboxes(category) {
  const contributors = [];
  for (const account of unifiedAccounts) {
    const hidden = getHiddenMailboxes(account);
    const mailbox = (mailboxesByAccount[account] ?? []).find(
      (m) => !hidden.has(m.hash) && unifiedCategoryKey(m) === category,
    );
    if (mailbox) contributors.push({ account, mailbox });
  }
  return contributors;
}
function renderUnifiedRows(rows) {
  lastUnifiedRows = rows;
  totalCount = rows.length;
  unreadCount = rows.filter((r) => !r.is_seen).length;
  currentMailboxOwnUnread = unreadCount;
  updateStatus();
  renderUnifiedTabs();

  const showPinnedFolder = currentUnifiedCategory === "Inbox";
  pinnedFolderEl.style.display = showPinnedFolder ? "" : "none";
  pinnedListEl.innerHTML = "";
  const canMoveCache = new Map();
  const canMoveFor = (row) => {
    const key = `${row.account}::${row.mailboxHash}`;
    let canMove = canMoveCache.get(key);
    if (canMove === undefined) {
      canMove = hasMoveTargets(row.mailboxHash, mailboxesByAccount[row.account] ?? [], row.account);
      canMoveCache.set(key, canMove);
    }
    return canMove;
  };

  const visibleRows = applyQuickFilters(rows);
  const regularRows = [];
  for (const row of visibleRows) {
    if (showPinnedFolder && row.is_flagged) {
      pinnedListEl.appendChild(buildRow(row, canMoveFor(row)));
    } else {
      regularRows.push(row);
    }
  }
  // Same threading-excludes-pinned reasoning as renderMessageRows(). Real
  // Message-IDs are globally unique, so grouping across accounts here
  // can't accidentally merge unrelated messages from different accounts.
  const displayRows = threadViewEnabled ? flattenThreads(buildThreads(regularRows)) : regularRows;
  setVirtualRows(displayRows, (row) => buildRow(row, canMoveFor(row)));
  updatePinnedFolderCount();
  prefetchTopBodies(visibleRows);
}

async function loadUnifiedMessages() {
  const targetCategory = currentUnifiedCategory;
  const isStillCurrent = () => unifiedActive && currentUnifiedCategory === targetCategory;

  const contributors = unifiedContributingMailboxes(targetCategory);
  let paintedFromCache = false;
  if (contributors.length > 0) {
    const cachedRows = [];
    for (const { account, mailbox } of contributors) {
      const cached = mailboxMessagesCache.get(mailboxCacheKey(account, mailbox.hash));
      if (!cached) continue;
      for (const row of cached) {
        row.account = account;
        row.mailboxHash = mailbox.hash;
      }
      cachedRows.push(...cached);
    }
    if (cachedRows.length > 0) {
      renderUnifiedRows(cachedRows.sort((a, b) => b.date - a.date));
      paintedFromCache = true;
    }
  }
  if (!paintedFromCache) statusEl.textContent = "Loading…";

  const liveRows = [];
  if (paintedFromCache) {
    for (const { account, mailbox } of contributors) {
      liveRows.push(...(mailboxMessagesCache.get(mailboxCacheKey(account, mailbox.hash)) ?? []));
    }
  }
  const failed = [];
  try {
    const results = await invoke("fetch_mailbox_messages_batch", {
      requests: contributors.map(({ account, mailbox }) => ({ account, mailboxHash: mailbox.hash })),
    });
    for (const result of results) {
      const contributor = contributors.find(
        (c) => c.account === result.account && c.mailbox.hash === result.mailboxHash,
      );
      if (!contributor) continue;
      const { mailbox } = contributor;
      if (result.error || !result.rows) {
        console.error(`fetch_mailbox_messages failed for ${result.account}/${mailbox.name}`, result.error);
        failed.push(`${mailbox.name} (${result.account})`);
        continue;
      }
      const rows = result.rows;
      for (const row of rows) {
        row.account = result.account;
        row.mailboxHash = mailbox.hash;
      }
      mailbox.total = rows.length;
      mailbox.unread = rows.filter((r) => !r.is_seen).length;
      mailboxMessagesCache.set(mailboxCacheKey(result.account, mailbox.hash), rows);
      indexRowsIntoAddressBook(rows, mailbox);
      for (let i = liveRows.length - 1; i >= 0; i--) {
        if (liveRows[i].account === result.account && liveRows[i].mailboxHash === mailbox.hash) {
          liveRows.splice(i, 1);
        }
      }
      liveRows.push(...rows);
    }
  } catch (err) {
    console.error("fetch_mailbox_messages_batch failed", err);
    for (const { account, mailbox } of contributors) failed.push(`${mailbox.name} (${account})`);
  }
  persistMailboxMessagesCache();
  if (!isStillCurrent()) return;
  if (failed.length < contributors.length) {
    renderUnifiedRows(liveRows.slice().sort((a, b) => b.date - a.date));
  }
  if (failed.length > 0) {
    if (liveRows.length === 0 && !paintedFromCache) {
      statusEl.textContent = `error: couldn't reach ${failed.join(", ")}`;
      scheduleStatusRetry(loadUnifiedMessages);
    } else {
      showErrorToast(
        failed.length === 1 ? `Couldn't refresh ${failed[0]}` : `Couldn't refresh ${failed.length} mailboxes`,
      );
    }
  }
}

async function activateUnifiedMode() {
  let accounts;
  try {
    accounts = (await invoke("list_accounts")).map((a) => a.email);
  } catch (err) {
    statusEl.textContent = `error: ${err}`;
    scheduleStatusRetry(activateUnifiedMode);
    return;
  }
  unifiedAccounts = accounts;
  unifiedActive = true;
  localStorage.setItem("unifiedActive", "1");
  currentUnifiedCategory = "Inbox";

  let paintedFromCache = false;
  if (accounts.length > 0 && accounts.every((a) => (mailboxesByAccount[a] ?? []).length > 0)) {
    renderUnifiedTabs();
    const contributors = unifiedContributingMailboxes(currentUnifiedCategory);

    const cachedRows = [];
    for (const { account, mailbox } of contributors) {
      const cached = mailboxMessagesCache.get(mailboxCacheKey(account, mailbox.hash));
      if (!cached) continue;
      for (const row of cached) {
        row.account = account;
        row.mailboxHash = mailbox.hash;
      }
      cachedRows.push(...cached);
    }
    if (cachedRows.length > 0) {
      showEmptyReadingPane();
      renderUnifiedRows(cachedRows.sort((a, b) => b.date - a.date));
      paintedFromCache = true;
    }
  }

  if (!paintedFromCache) statusEl.textContent = "Connecting…";
  try {
    await Promise.all(
      accounts.map(async (account) => {
        mailboxesByAccount[account] = await invoke("fetch_mailboxes", { account });
      }),
    );
  } catch (err) {
    if (paintedFromCache) {
      showErrorToast(`Couldn't refresh accounts: ${err}`);
    } else {
      statusEl.textContent = `error: ${err}`;
    }
    scheduleStatusRetry(activateUnifiedMode);
    return;
  }
  persistMailboxesByAccount();
  renderUnifiedTabs();
  await loadUnifiedMessages();
  // Delayed so badge-priming doesn't compete for connection-pool slots with the visible mailbox loading
  setTimeout(primeUnifiedBadges, 2000);
}

async function primeUnifiedBadges() {
  const failed = [];
  await Promise.all(
    unifiedAccounts.flatMap((account) => {
      const hidden = getHiddenMailboxes(account);
      return (mailboxesByAccount[account] ?? [])
        .filter((m) => !hidden.has(m.hash) && unifiedCategoryKey(m) !== "Inbox")
        .map(async (mailbox) => {
          try {
            const rows = await invoke("fetch_mailbox_messages", { account, mailboxHash: mailbox.hash });
            mailbox.total = rows.length;
            mailbox.unread = rows.filter((r) => !r.is_seen).length;
            renderUnifiedTabs();
            mailboxMessagesCache.set(mailboxCacheKey(account, mailbox.hash), rows);
            persistMailboxMessagesCache();
            indexRowsIntoAddressBook(rows, mailbox);
          } catch (err) {
            console.error(`priming unified badge for ${account}/${mailbox.name} failed`, err);
            failed.push(`${mailbox.name} (${account})`);
          }
        });
    }),
  );
  if (failed.length > 0) {
    showErrorToast(
      failed.length === 1 ? `Couldn't refresh ${failed[0]}'s count` : `Couldn't refresh ${failed.length} tabs' counts`,
    );
  }
}

let unifiedManagePanelEl = null;

function buildUnifiedManageRow(account, mailbox, hidden) {
  const row = document.createElement("div");
  row.className = "mailbox-manage-row unified-manage-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "mailbox-manage-checkbox";
  checkbox.checked = !hidden.has(mailbox.hash);
  row.appendChild(checkbox);

  const label = document.createElement("label");
  label.className = "mailbox-manage-name";
  label.textContent = mailbox.name;
  label.addEventListener("click", (e) => {
    e.stopPropagation();
    checkbox.click();
  });
  row.appendChild(label);

  checkbox.addEventListener("change", () => {
    const current = getHiddenMailboxes(account);
    if (checkbox.checked) {
      current.delete(mailbox.hash);
    } else {
      current.add(mailbox.hash);
    }
    setHiddenMailboxes(current, account);
  });

  return row;
}

function renderUnifiedManagePanelBody(panel) {
  panel.textContent = "";
  for (const account of unifiedAccounts) {
    const group = document.createElement("div");
    group.className = "unified-manage-account-group";

    const heading = document.createElement("div");
    heading.className = "unified-manage-account-heading";
    const nameEl = document.createElement("span");
    nameEl.textContent = account;
    heading.appendChild(nameEl);
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "unified-manage-add-btn";
    addBtn.title = `New folder in ${account}`;
    addBtn.textContent = "+";
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCreateMailbox(null, account, true);
    });
    heading.appendChild(addBtn);
    group.appendChild(heading);

    const hidden = getHiddenMailboxes(account);
    for (const mailbox of orderedMailboxes(mailboxesByAccount[account] ?? [])) {
      group.appendChild(buildUnifiedManageRow(account, mailbox, hidden));
    }
    panel.appendChild(group);
  }
}

async function toggleUnifiedManagePanel() {
  if (unifiedManagePanelEl) {
    closeUnifiedManagePanel();
    return;
  }
  const panel = document.createElement("div");
  panel.className = "mailbox-manage-panel unified-manage-panel";
  panel.textContent = "Loading…";
  unifiedManagePanelEl = panel;
  mailboxTabsEl.appendChild(panel);

  try {
    await Promise.all(
      unifiedAccounts.map(async (account) => {
        mailboxesByAccount[account] = await invoke("refresh_mailboxes", { account });
      }),
    );
  } catch (err) {
    panel.textContent = `error: ${err}`;
    return;
  }
  if (unifiedManagePanelEl !== panel) return;
  renderUnifiedManagePanelBody(panel);

  // Listener registration delayed to the next tick to avoid the opening click immediately triggering a close
  setTimeout(() => document.addEventListener("click", closeUnifiedManagePanelOnOutsideClick), 0);
}

function closeUnifiedManagePanel() {
  if (!unifiedManagePanelEl) return;
  unifiedManagePanelEl.remove();
  unifiedManagePanelEl = null;
  document.removeEventListener("click", closeUnifiedManagePanelOnOutsideClick);
  renderUnifiedTabs();
  loadUnifiedMessages();
}

function closeUnifiedManagePanelOnOutsideClick(e) {
  if (unifiedManagePanelEl && !unifiedManagePanelEl.contains(e.target)) {
    closeUnifiedManagePanel();
  }
}

async function toggleUnifiedInbox() {
  closeSettingsPanel();
  if (!searchResultsEl.hidden) hideSearchGrid();
  if (unifiedActive) {
    unifiedActive = false;
    localStorage.setItem("unifiedActive", "");
    currentMailboxHash = null;
    await loadMailboxes();
  } else {
    await activateUnifiedMode();
  }
}

async function toggleAccountPills() {
  showAccountPills = !showAccountPills;
  localStorage.setItem("showAccountPills", showAccountPills ? "1" : "0");
  const container = settingsPanelEl?.querySelector("#settings-account-list");
  if (container) {
    try {
      renderSettingsAccountRows(container, await invoke("list_accounts"));
    } catch (err) {
      console.error("list_accounts failed", err);
      showErrorToast(`Couldn't load accounts: ${err}`);
    }
  }
  if (unifiedActive) await loadUnifiedMessages();
}

async function toggleThreadView() {
  threadViewEnabled = !threadViewEnabled;
  localStorage.setItem("threadViewEnabled", threadViewEnabled ? "1" : "");
  const container = settingsPanelEl?.querySelector("#settings-account-list");
  if (container) {
    try {
      renderSettingsAccountRows(container, await invoke("list_accounts"));
    } catch (err) {
      console.error("list_accounts failed", err);
      showErrorToast(`Couldn't load accounts: ${err}`);
    }
  }
  rerenderCurrentMailboxView();
}

function parseSearchQuery(raw) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  const terms = [];
  const operators = {};
  for (const token of tokens) {
    const colonIndex = token.indexOf(":");
    if (colonIndex > 0) {
      const key = token.slice(0, colonIndex).toLowerCase();
      const value = token.slice(colonIndex + 1);
      if (value.length > 0 && ["from", "to", "cc", "subject", "has", "is", "account", "in"].includes(key)) {
        (operators[key] ??= []).push(value);
        continue;
      }
    }
    if (token.length > 0) terms.push(token);
  }
  return { terms, operators };
}

function containsCI(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function matchesQuery(row, parsed) {
  for (const term of parsed.terms) {
    const hit =
      containsCI(row.subject, term) || containsCI(row.from, term) || row.to.some((a) => containsCI(a, term));
    if (!hit) return false;
  }
  for (const [key, values] of Object.entries(parsed.operators)) {
    const matchesOne = (value) => {
      switch (key) {
        case "from":
          return containsCI(row.from, value);
        case "to":
          return row.to.some((a) => containsCI(a, value));
        case "cc":
          return row.cc.some((a) => containsCI(a, value));
        case "subject":
          return containsCI(row.subject, value);
        case "has":
          return value.toLowerCase() === "attachment" ? row.has_attachments : false;
        case "is":
          if (value.toLowerCase() === "unread") return !row.is_seen;
          if (value.toLowerCase() === "read") return row.is_seen;
          if (value.toLowerCase() === "pinned") return row.is_flagged;
          return false;
        case "account":
          return containsCI(row.account, value);
        case "in":
          return containsCI(row.mailboxLabel, value);
        default:
          return false;
      }
    };
    if (!values.some(matchesOne)) return false;
  }
  return true;
}

async function ensureMailboxesForAllAccounts() {
  let accounts = [];
  try {
    accounts = (await invoke("list_accounts")).map((a) => a.email);
  } catch (err) {
    console.error("list_accounts failed", err);
    showErrorToast(`Couldn't load accounts: ${err}`);
    return [];
  }
  const failedAccounts = [];
  await Promise.all(
    accounts
      .filter((account) => !(account in mailboxesByAccount))
      .map(async (account) => {
        try {
          mailboxesByAccount[account] = await invoke("fetch_mailboxes", { account });
        } catch (err) {
          console.error(`fetch_mailboxes failed for ${account}`, err);
          mailboxesByAccount[account] = [];
          failedAccounts.push(account);
        }
      }),
  );

  if (failedAccounts.length > 0) {
    showErrorToast(`Search couldn't reach: ${failedAccounts.join(", ")}`);
  }
  return accounts;
}

async function runSearch(query) {
  searchQuery = query;
  const parsed = parseSearchQuery(query.trim());
  if (parsed.terms.length === 0 && Object.keys(parsed.operators).length === 0) {
    await exitSearch();
    return;
  }

  if (!searchActive) {
    preSearchState = { unifiedActive, currentMailboxHash, currentUnifiedCategory, activeAccount };
    searchActive = true;
  }

  const allAccounts = await ensureMailboxesForAllAccounts();
  const accountValues = parsed.operators.account ?? [];
  const inValues = parsed.operators.in ?? [];
  const accounts = allAccounts.filter(
    (account) => accountValues.length === 0 || accountValues.some((v) => containsCI(account, v)),
  );

  // The exact (account, mailbox) set this search covers - computed once,
  // used both for the instant cache-first paint below and the real fetch
  // that follows it.
  const targets = [];
  for (const account of accounts) {
    const hidden = getHiddenMailboxes(account);
    const mailboxes = (mailboxesByAccount[account] ?? []).filter(
      (m) => !hidden.has(m.hash) && (inValues.length === 0 || inValues.some((v) => containsCI(m.name, v))),
    );
    for (const mailbox of mailboxes) targets.push({ account, mailbox });
  }

  const cachedRows = [];
  for (const { account, mailbox } of targets) {
    const cached = mailboxMessagesCache.get(mailboxCacheKey(account, mailbox.hash));
    if (!cached) continue;
    for (const row of cached) {
      row.account = account;
      row.mailboxHash = mailbox.hash;
      row.mailboxLabel = mailbox.name;
    }
    cachedRows.push(...cached);
  }
  const thisSearchQuery = query;
  if (cachedRows.length > 0) {
    searchResults = cachedRows.filter((row) => matchesQuery(row, parsed));
    sortSearchResults();
    renderSearchTabAndGrid();
  } else {
    statusEl.textContent = "Searching…";
  }

  const liveRows = [...cachedRows];
  const failedMailboxes = [];
  const fetches = targets.map(({ account, mailbox }) =>
    invoke("fetch_mailbox_messages", { account, mailboxHash: mailbox.hash })
      .then((rows) => {
        for (const row of rows) {
          row.account = account;
          row.mailboxHash = mailbox.hash;
          row.mailboxLabel = mailbox.name;
        }
        mailboxMessagesCache.set(mailboxCacheKey(account, mailbox.hash), rows);
        indexRowsIntoAddressBook(rows, mailbox);
        for (let i = liveRows.length - 1; i >= 0; i--) {
          if (liveRows[i].account === account && liveRows[i].mailboxHash === mailbox.hash) {
            liveRows.splice(i, 1);
          }
        }
        liveRows.push(...rows);
        scheduleSearchRender(() => {
          if (searchQuery !== thisSearchQuery) return;
          searchResults = liveRows.filter((row) => matchesQuery(row, parsed));
          sortSearchResults();
          renderSearchTabAndGrid();
        });
      })
      .catch((err) => {
        console.error(`fetch_mailbox_messages failed for ${account}/${mailbox.name}`, err);
        failedMailboxes.push(`${mailbox.name} (${account})`);
      }),
  );
  await Promise.all(fetches);
  persistMailboxMessagesCache();

  if (searchQuery !== thisSearchQuery) return;
  if (failedMailboxes.length > 0) {
    showErrorToast(
      failedMailboxes.length === 1
        ? `Search couldn't reach ${failedMailboxes[0]}`
        : `Search couldn't reach ${failedMailboxes.length} mailboxes`,
    );
  }
}

function sortSearchResults() {
  const { column, dir } = searchSort;
  const mul = dir === "asc" ? 1 : -1;
  const key = {
    from: (r) => r.from,
    subject: (r) => r.subject,
    account: (r) => r.account,
    mailbox: (r) => r.mailboxLabel,
    date: (r) => r.date,
  }[column];
  searchResults.sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return 0;
  });
}

function renderSearchTabAndGrid() {
  showSearchGrid();
  if (unifiedActive) {
    renderUnifiedTabs();
  } else {
    renderMailboxTabs();
  }
}

function appendSearchTab() {
  if (!searchActive) return;
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "mailbox-tab search-tab" + (!searchResultsEl.hidden ? " active" : "");
  tab.innerHTML = `<span class="mailbox-tab-name">Search</span>`;
  tab.addEventListener("click", switchToSearchTab);
  mailboxTabsEl.appendChild(tab);
}

function switchToSearchTab() {
  if (!searchResultsEl.hidden) return;
  showSearchGrid();
  if (unifiedActive) {
    renderUnifiedTabs();
  } else {
    renderMailboxTabs();
  }
}

function showSearchGrid() {
  inboxListEl.hidden = true;
  searchResultsEl.hidden = false;
  readingPaneEl.hidden = true;
  statusEl.textContent = `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`;
  searchGridBodyEl.innerHTML = "";
  for (const row of searchResults) {
    const canMove = hasMoveTargets(row.mailboxHash, mailboxesByAccount[row.account] ?? [], row.account);
    searchGridBodyEl.appendChild(buildSearchGridRow(row, canMove));
  }
}

function hideSearchGrid() {
  inboxListEl.hidden = false;
  searchResultsEl.hidden = true;
  readingPaneEl.hidden = false;
}

async function openSearchResultInContext(row) {
  if (unifiedActive) {
    const mailbox = (mailboxesByAccount[row.account] ?? []).find((m) => m.hash === row.mailboxHash);
    if (mailbox) {
      await switchUnifiedTab(unifiedCategoryKey(mailbox));
    } else {
      hideSearchGrid();
      renderUnifiedTabs();
      await loadUnifiedMessages();
    }
  } else {
    await switchAccount(row.account);
    await switchMailbox(row.mailboxHash);
  }
  const li = findOrScrollToRow(row.hash);
  if (li) {
    li.scrollIntoView({ block: "nearest" });
    openMessage(row, li);
  }
}

async function exitSearch() {
  if (!searchActive) return;
  const wasViewingSearch = !searchResultsEl.hidden;
  searchActive = false;
  searchQuery = "";
  searchResults = [];
  searchInputEl.value = "";
  searchClearEl.hidden = true;
  if (wasViewingSearch) hideSearchGrid();
  if (unifiedActive) {
    renderUnifiedTabs();
  } else {
    renderMailboxTabs();
  }

  if (wasViewingSearch && preSearchState) {
    showEmptyReadingPane();
    if (preSearchState.unifiedActive) {
      await loadUnifiedMessages();
    } else {
      await loadMessages();
    }
  }
  preSearchState = null;
}

function formatSearchDate(unixSeconds) {
  return escapeHtml(formatReceivedDate(unixSeconds));
}

function buildSearchGridRow(row, canMove) {
  const tr = document.createElement("tr");
  tr.className = "search-grid-row";
  if (!row.is_seen) tr.classList.add("unread");
  const color = accountColor(row.account);
  tr.innerHTML = `<td class="search-grid-status-col">
      <span class="unread-dot" title="Unread"></span>
      ${row.is_flagged ? `<span class="search-grid-status-icon" title="Pinned">${ICONS.pinFilled}</span>` : ""}
      ${row.has_attachments ? `<span class="search-grid-status-icon" title="Has attachment">${ICONS.attachment}</span>` : ""}
    </td>
    <td class="search-grid-from">${escapeHtml(row.from)}</td>
    <td class="search-grid-subject">${escapeHtml(row.subject)}</td>
    <td><span class="account-chip" style="background:${color.bg};color:${color.fg}" title="${escapeHtml(row.account)}">${escapeHtml(row.account.split("@")[0])}</span></td>
    <td class="search-grid-mailbox">${escapeHtml(row.mailboxLabel)}</td>
    <td class="search-grid-date">${formatSearchDate(row.date)}</td>
    <td class="search-grid-actions">
      <button class="row-action" data-action="reply" title="Reply">${ICONS.reply}</button>
      <button class="row-action" data-action="reply-all" title="Reply All">${ICONS.replyAll}</button>
      <button class="row-action" data-action="forward" title="Forward">${ICONS.forward}</button>
      ${canMove ? `<button class="row-action" data-action="move-to" title="Move to&hellip;">${ICONS.moveTo}</button>` : ""}
      <button class="row-action" data-action="toggle-read" title="${row.is_seen ? "Mark unread" : "Mark read"}">${row.is_seen ? ICONS.mailOpen : ICONS.mailClosed}</button>
      <button class="row-action" data-action="pin" title="${row.is_flagged ? "Unpin" : "Pin"}">${row.is_flagged ? ICONS.pinFilled : ICONS.pinOutline}</button>
      <button class="row-action" data-action="delete" title="Delete">${ICONS.delete}</button>
    </td>`;
  tr.addEventListener("click", () => openSearchResultInContext(row));

  const actionsEl = tr.querySelector(".search-grid-actions");
  actionsEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const button = e.target.closest(".row-action");
    if (!button) return;
    if (button.dataset.action === "delete") {
      deleteMessage(row, tr);
    } else if (button.dataset.action === "move-to") {
      const rect = button.getBoundingClientRect();
      openMoveMenu(rect.left, rect.bottom + 4, row, tr);
    } else if (button.dataset.action === "pin") {
      togglePin(row, button, tr);
    } else if (button.dataset.action === "toggle-read") {
      toggleRead(row, tr);
    } else if (
      button.dataset.action === "reply" ||
      button.dataset.action === "reply-all" ||
      button.dataset.action === "forward"
    ) {
      replyToMessage(row, button.dataset.action);
    }
  });

  return tr;
}

document.querySelectorAll("#search-results thead th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    if (searchSort.column === th.dataset.sort) {
      searchSort.dir = searchSort.dir === "asc" ? "desc" : "asc";
    } else {
      searchSort = { column: th.dataset.sort, dir: "asc" };
    }
    sortSearchResults();
    showSearchGrid();
  });
});

searchInputEl.addEventListener("input", () => {
  searchClearEl.hidden = searchInputEl.value.length === 0;
});

searchInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    runSearch(searchInputEl.value);
  } else if (e.key === "Escape") {
    runSearch("");
  }
});

searchClearEl.addEventListener("click", () => {
  runSearch("");
  searchInputEl.focus();
});

async function togglePin(row, button, li) {
  const value = !row.is_flagged;
  try {
    await invoke("set_flagged", {
      account: row.account,
      hash: row.hash,
      mailboxHash: row.mailboxHash,
      value,
    });
    row.is_flagged = value;
    button.innerHTML = value ? ICONS.pinFilled : ICONS.pinOutline;
    button.title = value ? "Unpin" : "Pin";
    if (searchResultsEl.hidden && isCurrentMailboxInbox()) {
      (value ? pinnedListEl : listEl).appendChild(li);
      updatePinnedFolderCount();
    }
  } catch (err) {
    console.error("set_flagged failed", err);
    showErrorToast(`Couldn't ${value ? "pin" : "unpin"} message: ${err}`);
  }
}

async function setSeenState(row, li, value) {
  if (row.is_seen === value) return;
  row.is_seen = value;
  li.classList.toggle("unread", !value);
  const button = li.querySelector('.row-action[data-action="toggle-read"]');
  if (button) {
    button.innerHTML = value ? ICONS.mailOpen : ICONS.mailClosed;
    button.title = value ? "Mark unread" : "Mark read";
  }
  unreadCount += value ? -1 : 1;
  currentMailboxOwnUnread += value ? -1 : 1;
  updateStatus();
  try {
    await invoke("set_seen", {
      account: row.account,
      hash: row.hash,
      mailboxHash: row.mailboxHash,
      value,
    });
  } catch (err) {
    row.is_seen = !value;
    li.classList.toggle("unread", value);
    if (button) {
      button.innerHTML = !value ? ICONS.mailOpen : ICONS.mailClosed;
      button.title = !value ? "Mark unread" : "Mark read";
    }
    unreadCount += value ? 1 : -1;
    currentMailboxOwnUnread += value ? 1 : -1;
    updateStatus();
    throw err;
  }
}

async function toggleRead(row, li) {
  try {
    await setSeenState(row, li, !row.is_seen);
  } catch (err) {
    console.error("set_seen failed", err);
    showErrorToast(`Couldn't update read status: ${err}`);
  }
}

async function deleteMessage(row, li) {
  try {
    await invoke("delete_message", {
      account: row.account,
      hash: row.hash,
      mailboxHash: row.mailboxHash,
    });
  } catch (err) {
    console.error("delete_message failed", err);
    showErrorToast(`Couldn't delete message: ${err}`);
    return;
  }
  totalCount -= 1;
  if (!row.is_seen) {
    unreadCount -= 1;
    currentMailboxOwnUnread -= 1;
  }
  adjustMailboxCounts(row.mailboxHash, -1, row.is_seen ? 0 : -1);
  updateStatus();
  if (li.classList.contains("selected")) {
    showEmptyReadingPane();
  }
  li.remove();
  removeFromSearchResults(row);
}

function removeFromSearchResults(row) {
  if (!searchActive) return;
  searchResults = searchResults.filter((r) => r !== row);
  statusEl.textContent = `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`;
}

let moveMenuEl = null;
let moveMenuRow = null;
let moveMenuLi = null;

function isCustomFolder(mailbox) {
  return mailbox.special_usage === "Normal";
}

function isMoveTreeRoot(mailbox, list = mailboxes) {
  if (!isCustomFolder(mailbox)) return false;
  if (!mailbox.parent_hash) return true;
  const parent = list.find((m) => m.hash === mailbox.parent_hash);
  return !parent || !isCustomFolder(parent);
}

function hasMoveTargets(sourceMailboxHash, list = mailboxes, account = activeAccount) {
  const hidden = getHiddenMailboxes(account);
  const containsTarget = (mailbox) => {
    if (mailbox.hash !== sourceMailboxHash) return true;
    return effectiveChildren(mailbox.hash, list).some(
      (child) => !hidden.has(child.hash) && containsTarget(child),
    );
  };
  return orderedMailboxes(list)
    .filter((m) => isMoveTreeRoot(m, list) && !hidden.has(m.hash))
    .some(containsTarget);
}

function buildMoveMenuNode(mailbox, sourceMailboxHash, depth, hidden, list = mailboxes) {
  const node = document.createElement("div");
  node.className = "move-menu-node";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "move-menu-name";
  button.style.paddingLeft = `${0.7 + depth * 1.1}rem`;
  button.textContent = mailbox.name;
  button.dataset.hash = mailbox.hash;
  if (mailbox.hash === sourceMailboxHash) {
    button.disabled = true;
    button.classList.add("current-folder");
  }
  node.appendChild(button);

  for (const child of effectiveChildren(mailbox.hash, list)) {
    if (hidden.has(child.hash)) continue;
    node.appendChild(buildMoveMenuNode(child, sourceMailboxHash, depth + 1, hidden, list));
  }
  return node;
}

function openMoveMenu(x, y, row, li) {
  closeMoveMenu();
  moveMenuRow = row;
  moveMenuLi = li;

  const list = mailboxesByAccount[row.account] ?? mailboxes;
  const hidden = getHiddenMailboxes(row.account);
  const menu = document.createElement("div");
  menu.className = "move-menu";
  const header = document.createElement("div");
  header.className = "move-menu-header";
  header.textContent = "Select a folder to move to";
  menu.appendChild(header);
  for (const mailbox of orderedMailboxes(list).filter((m) => isMoveTreeRoot(m, list))) {
    if (hidden.has(mailbox.hash)) continue;
    menu.appendChild(buildMoveMenuNode(mailbox, row.mailboxHash, 0, hidden, list));
  }
  menu.addEventListener("click", (e) => {
    const button = e.target.closest(".move-menu-name");
    if (!button || button.disabled) return;
    const targetRow = moveMenuRow;
    const targetLi = moveMenuLi;
    closeMoveMenu();
    moveMessage(targetRow, targetLi, targetRow.mailboxHash, button.dataset.hash);
  });
  document.body.appendChild(menu);
  moveMenuEl = menu;

  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, maxY))}px`;

  // Listener registration delayed to the next tick to avoid the opening click immediately triggering a close
  setTimeout(() => document.addEventListener("click", closeMoveMenuOnOutsideClick), 0);
}

function closeMoveMenu() {
  moveMenuEl?.remove();
  moveMenuEl = null;
  moveMenuRow = null;
  moveMenuLi = null;
  document.removeEventListener("click", closeMoveMenuOnOutsideClick);
}

function closeMoveMenuOnOutsideClick(e) {
  if (moveMenuEl && !moveMenuEl.contains(e.target)) closeMoveMenu();
}

function adjustMailboxCounts(mailboxHash, deltaTotal, deltaUnread) {
  const mailbox = mailboxes.find((m) => m.hash === mailboxHash);
  if (!mailbox) return;
  mailbox.total = Math.max(0, mailbox.total + deltaTotal);
  mailbox.unread = Math.max(0, mailbox.unread + deltaUnread);
}

async function moveMessage(row, li, sourceMailboxHash, destinationMailboxHash) {
  try {
    await invoke("move_message", {
      account: row.account,
      hash: row.hash,
      sourceMailboxHash,
      destinationMailboxHash,
    });
  } catch (err) {
    console.error("move_message failed", err);
    showErrorToast(`Couldn't move message: ${err}`);
    return;
  }
  totalCount -= 1;
  if (!row.is_seen) {
    unreadCount -= 1;
    currentMailboxOwnUnread -= 1;
  }
  updateStatus();
  if (li.classList.contains("selected")) {
    showEmptyReadingPane();
  }
  li.remove();
  removeFromSearchResults(row);

  adjustMailboxCounts(sourceMailboxHash, -1, row.is_seen ? 0 : -1);
  adjustMailboxCounts(destinationMailboxHash, 1, row.is_seen ? 0 : 1);
  if (!unifiedActive) renderMailboxTabs();
}

function rowIsDraft(row) {
  const mailbox = (mailboxesByAccount[row.account] ?? []).find((m) => m.hash === row.mailboxHash);
  return mailbox?.special_usage === "Drafts";
}

async function editDraft(row) {
  try {
    const draft = await invoke("fetch_body", { account: row.account, hash: row.hash });
    openCompose({
      account: row.account,
      to: (draft.to ?? []).join(", "),
      cc: (draft.cc ?? []).join(", "),
      subject: draft.subject,
      bodyHtml: draft.is_html ? draft.body : `<p>${escapeHtml(draft.body)}</p>`,
      references: draft.references,
      editingDraft: { account: row.account, hash: row.hash, mailboxHash: row.mailboxHash },
    });
  } catch (err) {
    console.error("Failed to load draft", err);
    showErrorToast(`Couldn't open draft: ${err}`);
  }
}

async function openMessage(row, li) {
  if (rowIsDraft(row)) {
    await editDraft(row);
    return;
  }

  if (row.hash === openMessageHash) {
    li.classList.remove("selected");
    showEmptyReadingPane();
    return;
  }

  document
    .querySelectorAll(".inbox-row.selected, .search-grid-row.selected")
    .forEach((el) => el.classList.remove("selected"));
  li.classList.add("selected");

  if (!row.is_seen) {
    setSeenState(row, li, true).catch((err) => {
      console.error("set_seen failed", err);
      showErrorToast(`Couldn't mark message as read: ${err}`);
    });
  }

  const hash = row.hash;
  openMessageHash = hash;
  readingPaneEl.innerHTML = "<p class=\"placeholder\">Loading…</p>";
  try {
    const { body, is_html, attachments, from, to, cc, date, subject } = await fetchBodyCached(row.account, hash);
    readingPaneEl.innerHTML = "";
    readingPaneEl.appendChild(buildMessageHeader({ subject, from, to, cc, date }));
    const bodyContainer = document.createElement("div");
    bodyContainer.className = "reading-body";
    readingPaneEl.appendChild(bodyContainer);
    if (is_html) {
      renderHtmlBody(bodyContainer, body, getAllowedRemoteImages().has(hash), hash, attachments, row.account);
    } else {
      const attachmentBar = renderAttachmentBar(attachments, hash, row.account);
      if (attachmentBar) bodyContainer.appendChild(attachmentBar);
      const plainBody = document.createElement("div");
      plainBody.className = "plain-body";
      plainBody.textContent = body;
      bodyContainer.appendChild(plainBody);
    }
  } catch (err) {
    openMessageHash = null;
    readingPaneEl.textContent = `error: ${err}`;
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAttachmentBar(attachments, hash, account) {
  if (!attachments || attachments.length === 0) return null;

  const bar = document.createElement("div");
  bar.className = "attachment-bar";
  for (const att of attachments) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.title = `Open ${att.filename}`;
    chip.innerHTML = `<span class="attachment-chip-icon">${ICONS.attachment}</span>
      <span class="attachment-chip-name">${escapeHtml(att.filename)}</span>
      <span class="attachment-chip-size">${formatFileSize(att.size)}</span>
      <button class="attachment-chip-download" type="button" title="Save As…">${ICONS.download}</button>`;
    chip.addEventListener("click", () => openAttachment(account, hash, att.index));
    chip.querySelector(".attachment-chip-download").addEventListener("click", (e) => {
      e.stopPropagation();
      saveAttachment(account, hash, att.index, att.filename);
    });
    bar.appendChild(chip);
  }
  return bar;
}

async function openAttachment(account, hash, index) {
  try {
    await invoke("open_attachment", { account, hash, index });
  } catch (err) {
    console.error("open_attachment failed", err);
    showErrorToast(`Couldn't open attachment: ${err}`);
  }
}

async function saveAttachment(account, hash, index, filename) {
  try {
    const destPath = await window.__TAURI__.dialog.save({ defaultPath: filename });
    if (!destPath) return;
    await invoke("save_attachment", { account, hash, index, destPath });
  } catch (err) {
    console.error("save_attachment failed", err);
    showErrorToast(`Couldn't save attachment: ${err}`);
  }
}

function renderHtmlBody(container, body, allowRemoteImages = false, hash, attachments = [], account) {
  container.innerHTML = "";

  const attachmentBar = renderAttachmentBar(attachments, hash, account);
  if (attachmentBar) container.appendChild(attachmentBar);

  if (!allowRemoteImages && /<img[^>]+src=["']https?:/i.test(body)) {
    const banner = document.createElement("div");
    banner.className = "remote-image-banner";
    banner.innerHTML = "<span>Images blocked to protect your privacy.</span>";
    const btn = document.createElement("button");
    btn.textContent = "Show images";
    btn.addEventListener("click", () => {
      rememberRemoteImagesAllowed(hash);
      renderHtmlBody(container, body, true, hash, attachments, account);
    });
    banner.appendChild(btn);
    container.appendChild(banner);
  }

  const iframe = document.createElement("iframe");
  iframe.className = "body-frame";
  iframe.sandbox = "allow-popups";
  const imgSrc = allowRemoteImages ? "img-src https: http: data:;" : "img-src data:;";
  // Only opt the iframe into prefers-color-scheme:dark if the email CSS
  // actually references it - i.e the sender has composed with dark themes
  // in mind.
  const emailHasOwnDarkModeCss = /prefers-color-scheme\s*:\s*dark/i.test(body);
  const colorSchemeMeta = emailHasOwnDarkModeCss ? "light dark" : "light";
  const fallbackStyle = emailHasOwnDarkModeCss
    ? `<style>html,body{background:#fff;color:#111}` +
      `@media (prefers-color-scheme:dark){html,body{background:#1e1e1e;color:#e8e8e8}}</style>`
    : `<style>html,body{background:#fff;color:#111}</style>`;
  iframe.srcdoc =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; ${imgSrc} font-src data:;">` +
    `<meta name="color-scheme" content="${colorSchemeMeta}">` +
    fallbackStyle +
    body;
  container.appendChild(iframe);
}

const HEADER_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function buildMessageHeader({ subject, from, to, cc, date }) {
  const header = document.createElement("div");
  header.className = "message-header";
  const rows = [
    ["Subject", subject],
    ["From", from],
    ["To", (to ?? []).join(", ")],
  ];
  if (cc && cc.length > 0) rows.push(["Cc", cc.join(", ")]);
  rows.push(["Date", HEADER_DATE_FORMAT.format(new Date(date * 1000))]);
  header.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="message-header-row"><span class="message-header-label">${label}</span><span class="message-header-value">${escapeHtml(value)}</span></div>`,
    )
    .join("");
  return header;
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const DATE_FORMAT_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatReceivedDate(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const now = new Date();

  if (startOfDay(date) === startOfDay(now)) {
    return TIME_FORMAT.format(date);
  }

  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (daysAgo >= 1 && daysAgo < 7) {
    return WEEKDAY_FORMAT.format(date);
  }
  if (date.getFullYear() === now.getFullYear()) {
    return DATE_FORMAT.format(date);
  }
  return DATE_FORMAT_WITH_YEAR.format(date);
}

function htmlToPlainText(html) {
  const scratch = document.createElement("div");
  scratch.innerHTML = html;
  scratch.querySelectorAll("script, style").forEach((el) => el.remove());
  scratch.querySelectorAll("img").forEach((img) => {
    const label = img.getAttribute("alt")?.trim() || img.getAttribute("src")?.split("/").pop() || "image";
    img.replaceWith(`[Image: ${label}]`);
  });
  scratch.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  scratch.querySelectorAll("p, div, tr, li, h1, h2, h3, h4, h5, h6").forEach((el) => {
    el.append("\n");
  });
  return scratch.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeQuotedHtml(html, allowRemoteImages) {
  const scratch = document.createElement("div");
  scratch.innerHTML = html;
  scratch.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((el) => el.remove());
  scratch.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  if (!allowRemoteImages) {
    scratch.querySelectorAll('img[src^="http:"], img[src^="https:"]').forEach((img) => {
      img.removeAttribute("src");
    });
  }
  return scratch.innerHTML;
}

function ensureSubjectPrefix(subject, prefix) {
  return new RegExp(`^${prefix}:\\s*`, "i").test(subject) ? subject : `${prefix}: ${subject}`;
}

function extractEmail(addressEntry) {
  const match = addressEntry.match(/<([^>]+)>/);
  return (match ? match[1] : addressEntry).trim().toLowerCase();
}

function dedupeAddressList(entries, selfAccount = activeAccount) {
  const seen = new Set();
  const out = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    const email = extractEmail(entry);
    if (email === selfAccount.toLowerCase() || seen.has(email)) continue;
    seen.add(email);
    out.push(entry);
  }
  return out;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function confirmIncludeAttachments(attachments) {
  const count = attachments.length;
  const noun = count === 1 ? "attachment" : "attachments";
  const names = attachments.map((a) => a.filename).join(", ");
  forwardAttachmentsSummaryEl.textContent = `This message has ${count} ${noun}: ${names}`;
  forwardAttachmentsOverlayEl.hidden = false;

  return new Promise((resolve) => {
    const cleanup = (result) => {
      forwardAttachmentsOverlayEl.hidden = true;
      forwardAttachmentsIncludeEl.removeEventListener("click", onInclude);
      forwardAttachmentsSkipEl.removeEventListener("click", onSkip);
      forwardAttachmentsCloseEl.removeEventListener("click", onSkip);
      resolve(result);
    };
    const onInclude = () => cleanup(true);
    const onSkip = () => cleanup(false);
    forwardAttachmentsIncludeEl.addEventListener("click", onInclude);
    forwardAttachmentsSkipEl.addEventListener("click", onSkip);
    forwardAttachmentsCloseEl.addEventListener("click", onSkip);
  });
}

forwardAttachmentsOverlayEl.addEventListener("click", (e) => {
  if (e.target === forwardAttachmentsOverlayEl) forwardAttachmentsCloseEl.click();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !forwardAttachmentsOverlayEl.hidden) forwardAttachmentsCloseEl.click();
});

async function replyToMessage(row, mode) {
  let msg;
  try {
    msg = await fetchBodyCached(row.account, row.hash);
  } catch (err) {
    alert(`Could not load the original message: ${err}`);
    return;
  }

  const allowRemoteImages = getAllowedRemoteImages().has(row.hash);
  const originalHtml = msg.is_html
    ? sanitizeQuotedHtml(msg.body, allowRemoteImages)
    : escapeHtml(msg.body).replace(/\n/g, "<br>");
  const whenSent = new Date(msg.date * 1000).toLocaleString();

  if (mode === "forward") {
    let forwardAttachments = null;
    let attachmentsLine = "";
    if (msg.attachments.length > 0) {
      const wantsAttachments = await confirmIncludeAttachments(msg.attachments);
      if (wantsAttachments) {
        forwardAttachments = {
          sourceHash: row.hash,
          sourceAccount: row.account,
          attachments: msg.attachments,
        };
        attachmentsLine = `<br>Attachments: ${escapeHtml(msg.attachments.map((a) => a.filename).join(", "))}`;
      }
    }

    const bodyHtml =
      "<p><br></p>" +
      "<p>---------- Forwarded message ----------<br>" +
      `From: ${escapeHtml(msg.from)}<br>Date: ${escapeHtml(whenSent)}<br>` +
      `Subject: ${escapeHtml(msg.subject)}<br>To: ${escapeHtml(msg.to.join(", "))}${attachmentsLine}</p>` +
      `<blockquote>${originalHtml}</blockquote>`;
    openCompose({ subject: ensureSubjectPrefix(msg.subject, "Fwd"), bodyHtml, forwardAttachments, account: row.account });
    return;
  }

  const primaryTo = msg.reply_to || msg.from;
  const to =
    mode === "reply-all"
      ? dedupeAddressList([primaryTo, ...msg.to], row.account).join(", ") || primaryTo
      : primaryTo;
  const cc = mode === "reply-all" ? dedupeAddressList(msg.cc, row.account).join(", ") : "";

  const bodyHtml =
    "<p><br></p>" +
    `<p>On ${escapeHtml(whenSent)}, ${escapeHtml(msg.from)} wrote:</p>` +
    `<blockquote>${originalHtml}</blockquote>`;

  openCompose({
    to,
    cc,
    subject: ensureSubjectPrefix(msg.subject, "Re"),
    bodyHtml,
    inReplyTo: msg.message_id,
    references: msg.references ? `${msg.references} ${msg.message_id}` : msg.message_id,
    account: row.account,
  });
}

let composeInReplyTo = "";
let composeReferences = "";
let composeForwardAttachments = null;

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
    if (e.key === "Escape") closeCompose();
  });
}
initComposeBodyDoc();

composeToolbarEl.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-cmd]");
  if (!button) return;
  composeBodyEl.contentWindow.focus();
  composeBodyEl.contentDocument.execCommand(button.dataset.cmd, false, null);
});

composeLinkButtonEl.addEventListener("click", () => {
  const doc = composeBodyEl.contentDocument;
  const win = composeBodyEl.contentWindow;
  win.focus();
  const hasSelection = (win.getSelection()?.toString() ?? "").trim().length > 0;
  const url = prompt("Link URL:");
  if (!url) return;
  if (hasSelection) {
    doc.execCommand("createLink", false, url);
  } else {
    const safeUrl = escapeHtml(url);
    doc.execCommand("insertHTML", false, `<a href="${safeUrl}">${safeUrl}</a>`);
  }
});

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

function renderComposeAttachmentsBar() {
  composeAttachmentsBarEl.innerHTML = "";
  if (!composeForwardAttachments || composeForwardAttachments.attachments.length === 0) {
    composeAttachmentsBarEl.hidden = true;
    return;
  }
  composeAttachmentsBarEl.hidden = false;
  const { sourceHash, sourceAccount, attachments } = composeForwardAttachments;
  for (const att of attachments) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.title = `Open ${att.filename}`;
    chip.innerHTML = `<span class="attachment-chip-icon">${ICONS.attachment}</span>
      <span class="attachment-chip-name">${escapeHtml(att.filename)}</span>
      <span class="attachment-chip-size">${formatFileSize(att.size)}</span>
      <button class="attachment-chip-remove" type="button" title="Remove">&times;</button>`;
    chip.addEventListener("click", () => openAttachment(sourceAccount, sourceHash, att.index));
    chip.querySelector(".attachment-chip-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      composeForwardAttachments.attachments = composeForwardAttachments.attachments.filter(
        (a) => a.index !== att.index,
      );
      renderComposeAttachmentsBar();
    });
    composeAttachmentsBarEl.appendChild(chip);
  }
}

async function openCompose(prefill) {
  editingDraft = prefill?.editingDraft ?? null;
  composeFormEl.reset();
  composeErrorEl.textContent = "";
  composeCcFieldEl.hidden = true;
  composeBccFieldEl.hidden = true;
  composeShowCcEl.hidden = false;
  composeShowBccEl.hidden = false;

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

  composeOverlayEl.hidden = false;
  if (prefill) {
    placeComposeCaretAtStart();
  } else {
    composeToEl.focus();
  }

  let accounts = [];
  try {
    accounts = await invoke("list_accounts");
  } catch (err) {
    console.error("list_accounts failed", err);
    showErrorToast(`Couldn't load accounts: ${err}`);
  }
  const desired = prefill?.account ?? activeAccount;
  composeAccountEl.innerHTML = accounts
    .map((a) => `<option value="${escapeHtml(a.email)}">${escapeHtml(a.email)}</option>`)
    .join("");
  composeAccountEl.value = accounts.some((a) => a.email === desired) ? desired : (accounts[0]?.email ?? "");
  composeAccountFieldEl.hidden = accounts.length < 2;
}

function closeCompose() {
  composeOverlayEl.hidden = true;
}

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

composeButtonEl.addEventListener("click", () => openCompose());

settingsButtonEl.innerHTML = ICONS.hamburger;
settingsButtonEl.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleSettingsPanel();
});
document.getElementById("compose-cancel").addEventListener("click", closeCompose);
document.getElementById("compose-close").addEventListener("click", closeCompose);

composeOverlayEl.addEventListener("click", (e) => {
  if (e.target === composeOverlayEl) closeCompose();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !composeOverlayEl.hidden) closeCompose();
});

function gatherComposeFields() {
  const bodyHtml = getComposeBodyHtml();
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
  };
}

async function refreshMailboxView(account, mailboxHash) {
  mailboxMessagesCache.delete(mailboxCacheKey(account, mailboxHash));
  persistMailboxMessagesCache();
  if (!unifiedActive && activeAccount === account && currentMailboxHash === mailboxHash) {
    await loadMessages();
    return true;
  }
  if (unifiedActive) {
    const mailbox = (mailboxesByAccount[account] ?? []).find((m) => m.hash === mailboxHash);
    if (mailbox && currentUnifiedCategory === unifiedCategoryKey(mailbox)) {
      await loadUnifiedMessages();
      return true;
    }
  }
  return false;
}

async function discardEditedDraft() {
  const draft = editingDraft;
  editingDraft = null;
  if (!draft) return;
  try {
    await invoke("delete_message", {
      account: draft.account,
      hash: draft.hash,
      mailboxHash: draft.mailboxHash,
    });
  } catch (err) {
    console.error("Failed to discard previous draft version", err);
    return;
  }
  const refreshed = await refreshMailboxView(draft.account, draft.mailboxHash);
  if (refreshed) return;
  if (!unifiedActive && draft.account === activeAccount) {
    const drafts = mailboxes.find((m) => m.special_usage === "Drafts");
    if (drafts) {
      adjustMailboxCounts(drafts.hash, -1, 0);
      renderMailboxTabs();
    }
  }
  const li =
    listEl.querySelector(`[data-hash="${draft.hash}"]`) ?? pinnedListEl.querySelector(`[data-hash="${draft.hash}"]`);
  li?.remove();
}

composeFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  composeErrorEl.textContent = "";
  composeSendEl.disabled = true;
  composeSendEl.textContent = "Sending…";
  try {
    await invoke("send_message", gatherComposeFields());
    closeCompose();
    await discardEditedDraft();
  } catch (err) {
    composeErrorEl.textContent = `${err}`;
  } finally {
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
    await discardEditedDraft();
    closeCompose();
    showToast("Draft saved", "success");
    if (!wasEditingDraft) {
      const drafts = (mailboxesByAccount[fields.account] ?? []).find((m) => m.special_usage === "Drafts");
      if (drafts) {
        const refreshed = await refreshMailboxView(fields.account, drafts.hash);
        if (!refreshed && !unifiedActive && fields.account === activeAccount) {
          adjustMailboxCounts(drafts.hash, 1, 0);
          renderMailboxTabs();
        }
      }
    }
  } catch (err) {
    composeErrorEl.textContent = `${err}`;
  } finally {
    composeSaveDraftEl.disabled = false;
    composeSaveDraftEl.textContent = "Save draft";
  }
});

async function purgeOrphanedAccountCaches(registeredEmails) {
  const registered = new Set(registeredEmails);
  const seen = new Set();
  for (const key of mailboxMessagesCache.keys()) {
    const account = key.split("::")[0];
    if (account) seen.add(account);
  }
  for (const key of messageBodyCache.keys()) {
    const account = key.split("::")[0];
    if (account) seen.add(account);
  }
  for (const account of Object.keys(mailboxesByAccount)) {
    seen.add(account);
  }
  for (const account of seen) {
    if (!registered.has(account)) await purgeAccountCaches(account);
  }
}

(async () => {
  let registeredAccounts = [];
  try {
    registeredAccounts = await invoke("list_accounts");
    await purgeOrphanedAccountCaches(registeredAccounts.map((a) => a.email));
    const savedAccount = localStorage.getItem("activeAccount");
    const stillRegistered = registeredAccounts.some((a) => a.email === savedAccount);
    activeAccount = stillRegistered ? savedAccount : (registeredAccounts[0]?.email ?? "");
  } catch (err) {
    console.error("list_accounts failed", err);
    showErrorToast(`Couldn't load accounts: ${err}`);
  }
  if (registeredAccounts.length === 0) {
    resetToSignedOutState();
  } else if (localStorage.getItem("unifiedActive") === "1") {
    activateUnifiedMode();
  } else {
    loadMailboxes();
  }
})();

invoke("check_for_update")
  .then((info) => {
    availableUpdate = info;
    if (!availableUpdate) return;
    if (unifiedActive) renderUnifiedTabs();
    else renderMailboxTabs();
  })
  .catch(() => {});

function prependNewMailRow(account, row) {
  const inbox = (mailboxesByAccount[account] ?? []).find((m) => m.special_usage === "Inbox");
  if (!inbox) return;
  row.account = account;
  row.mailboxHash = inbox.hash;
  const key = mailboxCacheKey(account, inbox.hash);
  const existing = mailboxMessagesCache.get(key) ?? [];
  if (existing.some((r) => r.hash === row.hash)) return;
  const updated = [row, ...existing];
  mailboxMessagesCache.set(key, updated);
  persistMailboxMessagesCache();
  indexRowsIntoAddressBook([row], inbox);

  const viewingThisInboxNormally = !unifiedActive && activeAccount === account && currentMailboxHash === inbox.hash;
  const viewingThisInboxUnified = unifiedActive && currentUnifiedCategory === "Inbox" && unifiedAccounts.includes(account);
  if (viewingThisInboxUnified) {
    const merged = [];
    for (const { account: a, mailbox: m } of unifiedContributingMailboxes("Inbox")) {
      merged.push(...(mailboxMessagesCache.get(mailboxCacheKey(a, m.hash)) ?? []));
    }
    renderUnifiedRows(merged.sort((a, b) => b.date - a.date));
  } else if (viewingThisInboxNormally) {
    renderMessageRows(updated);
  } else {
    inbox.total += 1;
    if (!row.is_seen) inbox.unread += 1;
    if (unifiedActive) renderUnifiedTabs();
    else renderMailboxTabs();
  }
}

window.__TAURI__.event.listen("inbox-changed", async (event) => {
  const account = event.payload?.account;
  if (account && event.payload?.row) {
    prependNewMailRow(account, event.payload.row);
  }
  if (unifiedActive) {
    if (account && !unifiedAccounts.includes(account)) return;
    if (account) {
      try {
        mailboxesByAccount[account] = await invoke("refresh_mailboxes", { account });
      } catch (err) {
        console.error("mailbox refresh after new-mail event failed", err);
      }
    }
    renderUnifiedTabs();
    if (currentUnifiedCategory === "Inbox") {
      await loadUnifiedMessages();
    }
    return;
  }
  if (account && account !== activeAccount) return;
  try {
    mailboxes = await invoke("refresh_mailboxes", { account: activeAccount });
  } catch (err) {
    console.error("mailbox refresh after new-mail event failed", err);
  }
  renderMailboxTabs();
  if (isCurrentMailboxInbox()) {
    await loadMessages();
  }
});

window.__TAURI__.event.listen("open-message", async (event) => {
  const account = event.payload?.account;
  const hash = event.payload?.hash;
  if (!account || !hash) return;
  const inbox = (mailboxesByAccount[account] ?? []).find((m) => m.special_usage === "Inbox");
  if (!inbox) return;
  const row = (mailboxMessagesCache.get(mailboxCacheKey(account, inbox.hash)) ?? []).find((r) => r.hash === hash);
  if (!row) return;
  if (unifiedActive) {
    await switchUnifiedTab("Inbox");
  } else {
    await switchAccount(account);
    await switchMailbox(inbox.hash);
  }
  const li = findOrScrollToRow(hash);
  if (li) {
    li.scrollIntoView({ block: "nearest" });
    openMessage(row, li);
  }
});

setInterval(() => {
  if (!searchResultsEl.hidden) return;
  if (unifiedActive) {
    loadUnifiedMessages();
  } else if (currentMailboxHash) {
    loadMessages();
  }
}, 90_000);
