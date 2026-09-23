# TODO

Feature roadmap, in priority order:

1. Bulk select + move — checkboxes on message rows (normal mailbox view and
   search results), shift-click for a range, an action bar (move/mark
   read-unread/delete) once something's selected. Move opens one folder-tree
   picker per account represented in the selection (a move only ever happens
   within one account - Unified and cross-account search results can select
   rows from several accounts at once), each with its own "New folder..."
   option. No automatic matching, no persisted rules, no interaction with
   notifications - everything only happens because it was selected and
   clicked.
2. Body/content search — search bar currently only matches headers (subject/from/to/cc) and operators like `is:unread`/`has:attachment`, not message bodies.

Done: conversation/thread view, signatures in the composer (HTML, multiple per account, with images and links).

Deliberately not building: automatic filters/rules (auto-move by sender,
etc.). Both accounts are Gmail, which already has real server-side filters
(Settings -> Filters and Blocked Addresses) that run even when tarw is
closed and show up as ordinary IMAP folders/flags - a client-side version in
tarw would only run while the app is open, would be a second place to
maintain the same logic, and risks silently filing mail away unseen (the
Gmail filters, or manual move via item 1 above, cover this better).
