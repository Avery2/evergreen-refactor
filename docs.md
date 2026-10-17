# Design notes

This documents *why* the plugin behaves the way it does, and the Obsidian behaviour it is built on. It's the reasoning behind the rules in the README.

## The problem with Note Composer

Obsidian's built-in [Note Composer](https://help.obsidian.md/plugins/note-composer) core plugin does two things:

- **Merge notes** — fold one note into another and rewrite incoming links.
- **Extract current selection** — move a selected passage into a new note, replacing it in the source with a link to that new note.

Extraction is a *move*. That is exactly right when a passage belongs in one place. It is exactly wrong when:

- the passage belongs in several notes at once, or
- the original context is the point — a daily note entry that only makes sense on the day it was written, or
- you want edits to the original to flow through everywhere it's referenced.

Obsidian has no built-in way to say "this passage is also relevant over there" without moving it. That's the gap this plugin fills.

Related community plugins were reviewed before writing anything:

| Plugin | Approach | Why it isn't this |
| --- | --- | --- |
| Note Refactor | Extract selection into a new note | Moves text; single destination |
| Text Transporter | Push/pull text or block embeds between notes | Pulls text into the current note; not selection-first, and no multi-destination |
| Various "copy block link" scripts | Copy a link to the current block to the clipboard | You still have to paste and place it yourself, one note at a time |

None of them is *select a passage → choose several existing-or-new notes → leave the source alone*.

## What Obsidian actually supports

Everything below was verified against Obsidian's help pages, the plugin API, and the long-running forum threads about block-reference edge cases.

### Blocks

A **block** is a paragraph, list item, list, blockquote, table, or fenced code block. Block IDs are written differently depending on what they label:

| Block | Where the ID goes |
| --- | --- |
| Simple paragraph | At the end of the line, after a space: `Some text ^abc123` |
| List item | At the end of the item's last line |
| Whole list | On its own line, with a blank line **before** it |
| Blockquote, table, callout | On its own line, with blank lines before and after |
| Fenced code block | On its own line, after the closing fence |

The blank line before a whole-list ID is load-bearing. Without it, Obsidian binds the ID to the *last list item* rather than to the list. This is why `standaloneIdEdit` inserts `''` before the ID line, and why `hasBlankAfter` exists: the inserted ID also needs a blank line after it, unless one is already there.

### A paragraph is a run of lines, not a line

Consecutive non-blank lines are **one** block. This matters twice:

- A block ID must go at the end of the *paragraph*, i.e. on its last line. Putting it on an intermediate line of a multi-line paragraph breaks the reference.
- A selection that covers all the lines of a paragraph counts as the whole block, even though it spans several lines.

### The hard limitation

Obsidian can address a block, a heading, or a heading's section. It cannot address a sentence, a phrase, a word, part of a list item, a table cell, or part of a code block. This is the single most-requested block-reference feature and it has not shipped.

So a partial-paragraph selection is a genuine dead end, and the plugin treats it as one:

1. **Widen** — reference the enclosing paragraph. Safe, and always available.
2. **Split** — insert blank lines around the selection so it becomes its own paragraph. Offered *only* for plain paragraphs, because doing this to a list, table or code block would change its meaning.

The second option is a real structural change, so it is never automatic. The prompt says so, and it is one undo away.

### Headings and sections

`[[Note#Heading]]` embeds everything under that heading until the next heading of the same or higher level — the heading text itself is *not* included. Two consequences shape the code:

- A selection matches a section only if it starts at the heading or at the first line of its body, and ends at the last non-blank line of the body (`matchHeadingSection`).
- The heading text must be **unique** in the note, or `#Heading` resolves ambiguously. `isUniqueHeading` checks this and falls back to block IDs when it fails.

A heading inside a multi-paragraph selection is skipped rather than referenced, because the section reference would pull in more than was selected — and the user is told.

### Block IDs and trailing text

A block ID at the end of a line is not part of the passage. It is hidden when rendered, and selecting the visible text should count as selecting the whole block. That's why `contentEndColumn` strips a trailing `^id` before deciding whether a selection covers a block — otherwise re-running the plugin on a paragraph it had already marked would look like a partial selection.

### Link names

`[[…]]` has no escape mechanism for `#`, `^`, `|`, `[` or `]` in a note name. Rather than write a link that silently fails to resolve, `unusableTargetReason` refuses and explains. When two notes in the vault share a basename, the plugin falls back to the full vault path so the link stays unambiguous.

## How the code is arranged

The interesting logic is deliberately pure — no `obsidian` import — so it can be tested in plain Node.

```
src/
  document-model.ts    Markdown → lines → blocks. No knowledge of the plugin.
  selection-plan.ts    Selection + document → what to do, or why it can't be done.
  line-edits.ts        Whole-line replacements, applied bottom-up.
  reference.ts         Markdown for the reference itself, and preview text.
  writer.ts            Appending references and detecting existing ones.
  destination-path.ts  Where a new note goes.
  block-id.ts          Timestamped, valid, unique block IDs.
  types.ts             Settings shape and validation.
  settings.ts          Settings tab (Obsidian UI).
  modals.ts            Destination picker and decision prompt (Obsidian UI).
  main.ts              Command, editor edits, vault writes.
tests/                 Unit tests for everything above the Obsidian line.
```

The split matters because the hard parts — deciding what a selection covers, and deciding what to do when it can't be referenced — are exactly the parts that don't need Obsidian to verify.

### Two phases, in this order

1. **Mark the passage as addressable** in the source note, through the editor API so it lands in the undo history.
2. **Write the references** into the destination notes.

Doing it in this order means a reference is never briefly dangling. If step 2 fails, the source note is left with an unused block ID, which is harmless.

### Idempotence

Repeating the operation must not duplicate anything. Two mechanisms:

- If the passage already carries a block ID, that ID is **reused** rather than a new one being minted. Without this, a second run would generate a different ID and every dedupe check would miss.
- Before appending, `missingReferences` checks whether the destination already contains that anchor *inside a wiki link* — `anchorPattern` requires the anchor to be followed by `]`, `|` or `#`. A passing mention of the same words in prose does not count as a reference.

## Deliberate non-goals

- **No automatic topic suggestions.** Deciding that a passage belongs in `Improving relationships` is the thinking the user wants to do.
- **No editing of the destination beyond appending.** No "insert under heading", no sorting, no deduplicating old content.
- **No custom syntax.** Everything written is valid Markdown and valid Obsidian, so removing the plugin leaves the vault intact.
- **No background scanning or indexing.** The plugin only runs when the command is invoked.
