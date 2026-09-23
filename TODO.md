# TODO

Feature roadmap, in priority order:

1. Body/content search — search bar currently only matches headers (subject/from/to/cc) and operators like `is:unread`/`has:attachment`, not message bodies.

Done: conversation/thread view, signatures in the composer (HTML, multiple per account, with images and links), multi-select messages (Ctrl/Shift+click, no checkboxes/bar - a selected row's own action icons apply to the whole selection; Move handles cross-account selections one account at a time with a New folder... option).

Deliberately not building: automatic filters/rules (auto-move by sender,
etc.). Both accounts are Gmail, which already has real server-side filters
(Settings -> Filters and Blocked Addresses) that run even when tarw is
closed and show up as ordinary IMAP folders/flags - a client-side version in
tarw would only run while the app is open, would be a second place to
maintain the same logic, and risks silently filing mail away unseen (the
Gmail filters, or manual move via multi-select above, cover this better).
