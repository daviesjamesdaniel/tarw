# TODO

Feature roadmap, in priority order:

1. Image button in the normal compose body — signatures already support embedded images, but the main compose editor body has no way to insert an image.
2. Signature image from URL — signature images currently must be embedded/uploaded directly; add support for pointing a signature image at a URL instead.

Done: conversation/thread view, signatures in the composer (HTML, multiple per account, with images and links), multi-select messages (Ctrl/Shift+click, no checkboxes/bar - a selected row's own action icons apply to the whole selection; Move handles cross-account selections one account at a time with a New folder... option).

Deliberately not building: automatic filters/rules (auto-move by sender,
etc.). Both accounts are Gmail, which already has real server-side filters
(Settings -> Filters and Blocked Addresses) that run even when tarw is
closed and show up as ordinary IMAP folders/flags - a client-side version in
tarw would only run while the app is open, would be a second place to
maintain the same logic, and risks silently filing mail away unseen (the
Gmail filters, or manual move via multi-select above, cover this better).

Also dropped: body/content search. melib's standard IMAP SEARCH (Query::Body
-> "BODY", Query::AllText -> "TEXT") is real and provider-agnostic, not
Gmail-only, so it was technically viable - but it needs a per-mailbox
fan-out server round-trip (not local filtering like the current header
search) for uncertain value over what Gmail's own search already gives on
one of the two accounts. Revisit if the need becomes concrete.
