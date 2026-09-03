# What the day view actually looks like

Everything here was measured against the live Google Calendar day view (9 member columns, viewport
1156px wide, macOS Chrome). The class names are from that session's build and are expected to change;
they are recorded only to make the measurements reproducible, and the extension never matches on them.

## The columns live in five containers

A single day view spreads its columns across five separate `display: flex` containers. Every child is
`position: static`, which is why CSS `order` works at all.

| Container | Children | What it holds |
| --- | --- | --- |
| `DIV.djb5I` | 9 | Zero-height sizing helper. Invisible, and does not scroll. |
| `DIV.EYcIbe` | 11 | The header row. 9 columns plus a 9px leading and a 16px trailing spacer. |
| `DIV.ZDEHt` | 10 | The all-day row. |
| `UL.bOyeud` | 9 | The all-day event list. |
| `DIV.Tmdkcc` | 11 | The time grid body. |

Child counts differ per container because the spacers differ, so containers cannot be matched by
counting children. Non-column children need an explicit `order` too: left at the default `0` they sort
ahead of the columns, which throws the trailing spacer to the left edge.

An earlier heuristic — "a flex container with at least 8 children about 129px wide" — found only four
of these and silently missed `UL.bOyeud`, which would have left all-day events unsorted. Both halves of
that heuristic were also wrong in principle: the column count can be as low as 1, and the width changes
with the window.

## Identifying a column

`data-calendarid` exists in the DOM, but it belongs to **event chips** (work-location pills, all-day
events), not to the column. A column whose person has no chip that day exposes no id at all. Two
consecutive days in the measured account gave 9/9, but only because everyone had a work location set.

The display name is always available: within a header, the last `[aria-label]` that is not inside a
`[data-eventchip]`. For the user's own column the date labels come first, which is why it is the last
one and not the first.

The own column is the first `[role="columnheader"]` in DOM order. Applying `order` never changes DOM
order, so this stays true after reordering.

## Re-rendering

Moving one day forward, with inline `order` set on every child beforehand:

| Container | Children surviving |
| --- | --- |
| `DIV.djb5I` | 9 / 9 |
| `DIV.EYcIbe` | 11 / 11 |
| `DIV.ZDEHt` | 9 / 10 |
| `DIV.Tmdkcc` | **2 / 11** |

The time grid body is rebuilt almost entirely, so the order has to be re-applied. The header row and the
gridline helper are reused.

## Horizontal scrolling

With 9 members the columns total 1161px against a 1020px grid, so the view scrolls horizontally. There
are **three** independent horizontal scroll containers, which Google keeps in sync itself:

- `DIV.EYcIbe` — the header row
- `DIV.Qotkjb` — the all-day region
- `DIV.mDPmMe` — the time grid body

Two things follow:

1. **Google's sync does not run for programmatic scrolling.** A real wheel gesture moves all three
   together. Assigning `scrollLeft` does not: setting it on the body moved the body alone and left the
   header behind, and setting it on the header moved the header alone. The extension therefore sets
   `scrollLeft` on all three itself.
2. **`scrollWidth - clientWidth` is not the real limit.** Those properties are rounded to integers
   while the true maximum is fractional (measured 165.45). Passing a larger value makes the browser
   clamp each container to its own maximum, and the values drift apart. Writing once, reading back what
   settled, and re-assigning the smallest of those keeps all three exactly equal.

`DIV.djb5I` has no horizontal scroll container at all, so once the view is scrolled its children no
longer line up with the header anchors and it drops out of detection. It is invisible, so this costs
nothing.

At rest the header and body columns sit 0.093px apart. That is a constant sub-pixel offset, not drift,
and it is why the geometric match allows 2px of tolerance.

## Why the day view only

In week view the `[role="columnheader"]` elements are the days themselves — `月 31`, `火 1`, `水 2` and
so on. The same code pointed at that view would happily reorder the days of the week, so it has to
recognise the day view and stand down everywhere else.

The URL cannot be used for that. Chrome's "install as app" shortcut opens
`https://calendar.google.com/calendar/r` and renders the account's default view without ever
appending the view to the path, so a day view inside the app window sits at `/calendar/u/0/r` —
no `/r/day` anywhere. The extension used to require `/r/day` and was therefore permanently idle in
the app window, reporting `日表示ではありません`.

What does separate the views is how many distinct `data-datekey` values the page carries:

| View                | distinct `data-datekey` | `[role="columnheader"]`   |
| ------------------- | ----------------------- | ------------------------- |
| Day, 9 members      | 1                       | 9 (the members)           |
| Week, 5 days        | 5                       | 5 (the days)              |
| Month               | 25                      | 5 (weekday names)         |

Month view is the reason the test counts document-wide values rather than looking for a datekey
inside each header: its headers are bare weekday names and carry no datekey either, so "no datekey
in the header" would wave it through. Requiring *exactly one* distinct value across the document
also fails in the safe direction — if Google ever drops the attribute the count becomes 0 and the
extension stands down rather than reordering the days of a week. Opening the left drawer with its
mini calendar does not add datekeys; measured with the drawer both closed and open.
