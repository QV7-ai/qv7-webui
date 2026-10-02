# QV7 design

QV7 is a dark-first chat app. The conversation, the composer, and an open canvas are the only things that compete for attention. Accent marks the current choice. Everything else stays quiet.

Build new UI with the tokens and rules below. Do not introduce a second palette, a second typeface, or a new corner radius scale.

## Hierarchy

1. The current task is the loudest thing on the screen: the message being read, the composer, or the canvas preview.
2. Navigation and settings stay in the sidebar or a dialog. They do not sit on top of the transcript.
3. One primary action per surface. In a confirm dialog that is the danger or accent button on the right. In the composer it is send.
4. Meta, hints, and tags are smaller and `--muted`. They never share the same size as the title they support.
5. Progressive disclosure: the plus menu, tools, skills, and reasoning effort start collapsed. Open one section at a time.

## Color

Colors are CSS variables on `html`. Dark is the default. Light and OLED override the same names. A custom theme from the theme maker writes the same variables. Components use the variable, never a raw hex, except the few fixed colors listed here.

| Token | Dark | Light | OLED | Use |
| --- | --- | --- | --- | --- |
| `--bg` | `#1a1a1f` | `#f6f5f2` | `#000000` | App background |
| `--sidebar` | `#17171a` | `#eeede9` | `#000000` | Sidebar |
| `--elevated` | `#17171a` | `#ffffff` | `#050505` | Composer, dialogs, menus |
| `--surface` | `#27272a` | `#eeede9` | `#0a0a0a` | Rows, chips, inputs |
| `--hover` | `#2a2a2e` | `#e6e4de` | `#141414` | Hover and pressed rows |
| `--border` | white 8% | black 8% | white 10% | Hairline borders |
| `--text` | `#f5f5f5` | `#161513` | `#f5f5f5` | Primary text |
| `--secondary` | `#a1a1aa` | `#5c5a57` | `#a1a1aa` | Supporting text |
| `--muted` | `#71717a` | `#8a8782` | `#71717a` | Labels, meta |
| `--accent` | `#fe4901` | `#fe4901` | `#fe4901` | Brand orange |
| `--accent-soft` | orange 16% | orange 12% | orange 16% | Selected chips and toggles |
| `--danger` | `#ef6b5c` | `#ef6b5c` | `#ef6b5c` | Delete and errors |
| `--code-bg` | `#141416` | `#eeede9` | `#000000` | Code blocks |
| `--user` | `#27272a` | `#eceae4` | `#0a0a0a` | User message fill |

Rules:

- Do not invent a second orange. Selected tools, the main button, and the current row use `--accent` or `--accent-soft`.
- Body text on `--bg` and `--elevated` must stay `--text`. Hints stay `--muted`. Do not put `--muted` on a busy photo or a gradient.
- Errors are `--danger` text next to the action that failed. Do not paint the whole panel red.
- Beta and capability tags are muted pills on `--surface`, not accent pills.
- The skill default switch is the one green in the product: `#3dcc6d` when on, `--hover` when off.
- Context usage slices are fixed and are not brand colors: system `#9aa0a6`, skills `#e0a045`, tools `#7c6aef`, conversation `#e07a6a`. The ring turns `#e0a045` at 75% and `--danger` at 90%.
- Scrims are black at 60%.

## Type

- UI: Inter, then `ui-sans-serif, system-ui, sans-serif`. Weights 400, 500, 600 only.
- Code and the canvas code view: JetBrains Mono, 400 and 500.
- Base size 15px, line-height 1.5. The text size setting scales the page with `--text-scale` (zoom on `html`).
- On a phone, inputs, textareas, and selects are 16px so the browser does not zoom the page.
- Dialog titles are 16px medium. Settings page titles are 22px medium. Section titles are 15px medium. Row labels are 13–15px. Hints, tags, and meta are 11–12px in `--muted`.
- One weight step between a title and its body. Do not bold a whole paragraph.
- All-caps is only for Beta and for eyebrows at about 0.72rem with letter-spacing. Do not set whole labels in uppercase.
- Truncate names and URLs. Do not wrap a toolbar label onto a second line if a tag can sit beside it.
- English and Dutch share the same layout. Size the control for the longer label.

## Shape and elevation

- Composer and cards: `rounded-2xl`, 1px `--border`, elevated fill.
- Phone sheets: `rounded-t-3xl`, max height `86svh`.
- Menus and confirmations: `rounded-xl` or `rounded-2xl`, `shadow-xl` or `shadow-2xl`.
- Buttons and inputs: `rounded-lg`.
- Icon buttons are 32px (`h-8 w-8`) with padding that keeps the hit target near 44px on touch (`p-2` on a 16px icon).
- List rows on the phone are `h-11` or `h-12`. Sheet tiles are at least 92px tall.
- Leave space between adjacent hit targets. Do not pack two icon buttons flush.
- Chips are `rounded-md` or `rounded-full`. Active chips are `--accent-soft` with `--accent` text. Beta chips stay muted.
- The composer is the heaviest surface: border, elevated background, and shadow `0 8px 30px` black at 22%. Do not add a second shadow stack on the same screen.
- Scrollbars are thin and `#2a2a30` on transparent.

## Layout

The phone breakpoint is `767px` (`PHONE_QUERY`). Design the phone sheet first, then the desktop flyout.

- Below 767px, flyouts become bottom sheets. The chat column hides while a canvas is open. Skills in the sheet show about five rows (`max-h-[13.75rem]`) and scroll.
- At 768px and up, the canvas sits beside the chat at about 56% of the width with a left border.
- The chat column is centered: 40rem under 768px, 48rem from 768px, 52rem from 1024px, 56rem from 1920px, 60rem from 2560px.
- The shell is fixed to the visual viewport (`100svh` / `--app-height`). The page does not scroll behind the keyboard. When the keyboard is open, `.composer-pad` padding drops to `0.5rem`.
- Use `--safe-top` and `--safe-bottom`. On a phone the bottom inset is at least 24px, and the top inset is 25px.
- Settings panels are `max-w-xl`. A toggle row is a title plus a one-line hint, with the checkbox at the start of the text, not lost at the far edge of a wide screen.
- Do not autofocus a search field on a coarse pointer. Desktop flyouts may focus the search field. Submenus open on hover for a fine pointer and on tap for a coarse pointer.

## Motion

Motion is on unless the user turns it off. That sets `html[data-motion]`. `prefers-reduced-motion: reduce` also kills animation.

- Controls transition background, color, border, opacity, and shadow over 160ms ease.
- Pressed buttons scale to 0.97. Disabled buttons do not scale.
- Dialogs pop in over 180ms (`motion-pop`). Overlays fade over 160ms (`motion-fade`). Messages rise over 220ms (`motion-rise`).
- The settings dialog is `motion-static` so it is not animated twice.
- Motion off sets animation and transition duration to almost zero.
- One entrance, then still. No looping, no bounce, no parallax.
- Do not put `motion-pop` on a panel that already positions itself with a transform (the context usage panel uses `-translate-y-full` and fade only).

## Interaction

- A control does what its label says. A toggle with a check is on. A chip in the composer can be clicked again to turn that tool off.
- Confirm before a destructive delete. The dialog names the thing being removed. Nothing is deleted on the first click.
- If a tool is disabled for normal users, omit it. Do not show a dead row. Admins still see it.
- Show Thinking only when the model can think. Show Reasoning only when it has reasoning levels. Show Beta on Canvas, web search, and Document.
- Reasoning effort appears in the plus menu and in model settings only when that model has levels. Choosing a level turns thinking on.
- Switching chats closes the canvas. A new file in the chat you are in opens it again. The card on an older message still opens that file. A saved artifact keeps the edits from that message.
- While the model is writing, the canvas preview refreshes about every 10 seconds. The code view stays live. When the reply finishes, or the user edits the file, Preview shows that file right away.
- Do not put the system prompt in Additional Instructions. That box is the user's extra text only.
- Do not put skill chips in the composer bar. Skills are chosen in the plus menu and on the skills page.
- The skills default switch means “load this skill in a new chat.”
- Context counts under 10,000 are shown as the full number. The ring total is input plus the reply. The window is the loaded context, then the model's context length, then the user's setting. Do not invent 8192.
- Search queries use the subject of the question. Drop canvas, CSS, font, and layout instructions. If the user mentions Wikipedia, the query includes that word.
- Empty states are one `--muted` line. Errors are one `--danger` line and a way to retry or edit.
- Loading states name the wait: searching, reading the prompt, running code, updating memory.

## Components

**Buttons.** Primary is accent fill and white text. Subtle is a surface fill. Ghost is secondary text that highlights on hover. Danger is `--danger` text, not a filled red button. Disabled is 40% opacity and does not fire.

**Plus menu.** Desktop is an elevated flyout about 14rem wide. Phone is a bottom sheet titled “Add to chat”: large tiles for files and images, then rows for reasoning effort, tools, and skills. One section open at a time. Beta is a tag on the row, never a sentence under it.

**Composer.** One rounded field. Plus and the context ring sit on the left. Active tools become accent chips. Thinking and send sit on the right. Stop replaces send while a reply is streaming. Upload files accepts images, Markdown, and Word (.docx). The model reads the text from Markdown and Word files. A dropped file uses the same path. The drop label is “Drop a file to attach” / “Sleep een bestand om bij te voegen”. Document saves a Word file (.docx). A spreadsheet, plain-text, or HTML request still uses that format.

**Dialogs.** Scrim button covers the screen and cancels. The panel is elevated, about `max-w-sm`, with an `h2`, one short description, then Cancel and the action aligned to the end. Instructions on the phone use the same bottom sheet as the plus menu. On desktop, instructions are two columns and the preview stays on the right.

**Settings.** A title, then sections. Each toggle has a title and one hint. Changes save on their own after a short pause. The page shows Saving…, then Saved. Password, another user’s account, a connection draft, and a model draft still use a Save button.

**Models.** The name is the title. Main and private stay as words. Thinking and Reasoning are pills and are omitted when the model does not have that capability.

**Lists.** A row is a single hit target. The trailing control is a switch, a check, or an icon button with an accessible name. Search filters the list in place. Load more reveals the next page. Do not paginate with a page number the user must type.

**Canvas.** Header: title, language, the beta line on HTML pages, Preview, Code, save status, copy, share, download, version history, more actions, close. On a phone the panel is the whole screen and Chat returns to the conversation. Share copies a link when sharing is on. Opening that link shows the HTML page on its own, full screen. When the chat has more than one canvas file, of any language, the top bar shows a left arrow, the version number, and a right arrow. Those arrows open that version. The beta line under the title shows on every language. Version history lists saved versions and Restore puts that text back. The card in the chat only opens that file. Preview and Code are on every canvas file. Preview is a sandboxed iframe for HTML, JavaScript, TypeScript, JSX, and TSX (`allow-scripts`, not `allow-same-origin`) and for SVG and CSS (no scripts). JSX and TSX are compiled in the browser. React and its hooks come from the preview, and imported pieces such as Outlet, Link, icons, and local components are filled in. Markdown preview is rendered text. SQL, JSON, Python, and other files preview as the formatted source. HTML pages stay one document styled with Tailwind classes, with the Tailwind script and Font Awesome in the head. A separate CSS block in the chat is folded into that file and hidden. Other files (code, CSS, JavaScript, TypeScript, React, Markdown, JSON, SQL, SVG, text, config) use an artifact fence and do not appear in full in the chat. The code view has line numbers. Edits save on their own. A reply does not replace text the user changed after sending. The plus menu has Canvas only. A blank file is started from More actions on the canvas. More actions can ask for a fix, an improvement, a refactor, an explanation, a responsive layout, a feature, a conversion, an optimization, or a regeneration.

## Writing

- Labels are short and specific: “Reasoning effort”, “Web search”, “Delete skill”.
- Hints are one sentence and say what the control changes for the user.
- Buttons are verbs: Save, Delete skill, Load more, Cancel.
- Do not explain the implementation in the UI. “Canvas is in beta. Pages can still look unfinished.” is the beta line. It lives on the canvas panel, not under the tool row.
- The same string exists in English and Dutch. Layout does not depend on which one is longer.

## Accessibility

- Use a real `button`, `a`, `input`, or dialog. Do not click a `div`.
- Icon-only buttons have an `aria-label` in the user's language.
- Dialogs set `role="dialog"`, `aria-modal="true"`, and label themselves from the title.
- The keyboard can open, move through, and dismiss menus. Escape closes the top layer.
- Do not remove a focus style without a replacement the user can see. The global stylesheet currently clears the outline, so a new control still needs a hover or selected state that works for keyboard users.
- Images that mean something have alt text. Decorative icons are `aria-hidden`.
- Contrast follows the token pairs above: `--text` on `--bg` / `--elevated`, `--muted` only for secondary meta.

## Canvas documents

When the product asks a model to design a page, the page follows this shape:

- One HTML file. No second code block. No `<canvas>` tag. No LaTeX.
- Head includes Font Awesome and the Tailwind CDN.
- Body is `bg-slate-50`, sans, antialiased.
- A full-width gradient header, a pill label, a large title, an italic subtitle.
- A `max-w-4xl` column of white `rounded-2xl` cards: facts first, then several sections with icons, one tinted callout, then a dark footer.
- Color comes from the user's request. Blue means `from-blue-700` to `indigo-800`, not the CSS color name `blue`.
- The page is the deliverable. The chat message is one short sentence.
