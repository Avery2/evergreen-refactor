# Manual QA checklist

The automated tests cover the analysis, the edits, the reference syntax and the
duplicate detection. They cannot cover what Obsidian actually renders, so that
part is done by hand.

Before starting: install the plugin (see README), then open a scratch note and
add a heading `# QA scratch` plus the passages below.

---

## 1. A complete paragraph

```markdown
I keep noticing that I rush when I am tired.
```

1. Select the whole paragraph.
2. Run **Evergreen Refactor: Reference selection in another note…**.
3. Pick an existing note. Confirm.

- [ ] No prompt about limitations appeared — the common case should be frictionless.
- [ ] The source paragraph now ends with ` ^2026…-…`.
- [ ] The destination note ends with `![[… #^2026…-…]]` and nothing else.
- [ ] The destination renders the full sentence inline.
- [ ] The source paragraph still reads normally in reading view (the ID is invisible).

## 2. Part of a paragraph

```markdown
I keep noticing that I rush when I am tired.
```

1. Select only `I rush`.
2. Run the command.

- [ ] A prompt appears explaining that Obsidian can only reference whole paragraphs.
- [ ] Two options are offered: reference the whole paragraph, and split the paragraph.
- [ ] **Cancel** leaves the note completely untouched.
- [ ] Running it again and choosing **reference the whole paragraph** adds the ID at the end of the paragraph.
- [ ] Running it again on a fresh copy and choosing **split** produces three paragraphs with the selection in the middle, carrying the ID, and not one word changed.
- [ ] `Cmd/Ctrl+Z` undoes the split in a single step.

## 3. Several paragraphs

```markdown
First thought.

Second thought.
```

1. Select both paragraphs (including the blank line between them).
2. Run the command, pick a destination, confirm.

- [ ] The source gets **one** block ID per paragraph, not one for the pair.
- [ ] The destination gets **two** reference lines.
- [ ] Each reference renders only its own paragraph — the first embed does not include the second.

## 4. One passage, several destinations

1. Select a fresh paragraph.
2. Run the command.
3. In the picker: type a name, press `Enter` to add it; add a second existing note; then type a brand-new name so **Create "…"** appears and add that too.
4. Confirm.

- [ ] The footer counts the selected notes as you go.
- [ ] The new note is created (in the folder set in settings, or the vault root) containing only the reference.
- [ ] All destinations contain the *same* block ID.
- [ ] The passage text appears in no destination note.

## 5. Edits flow through

1. Open a destination note from test 4 in reading view, and the source note side by side.
2. In the source, reword the passage.
3. Watch the embed in the destination.

- [ ] The embed updates to the new wording without the destination being touched.
- [ ] The block ID at the end of the source paragraph is unchanged.

## 6. Repeating the operation

1. Select the same passage again and send it to a note it is already in.

- [ ] The destination is **not** modified (no second copy of the reference).
- [ ] The notice says it was already referenced there.
- [ ] If the passage already had an ID, no second ID is added to the source.

## 7. The three display settings

For each of **Full embedded passage**, **Short clickable preview**, and **Both**
in **Settings → Evergreen Refactor → Reference display**, reference a new
paragraph into a fresh note and check the result:

- [ ] **Full embedded passage** — only `![[Note#^id]]`, rendering the passage inline.
- [ ] **Short clickable preview** — only `[[Note#^id|first few words…]]`, which is clickable and shows the preview text, not the whole passage.
- [ ] **Both** — a clickable line followed by the full embed.
- [ ] The preview text never contains a stray `|`, `[` or `]` that breaks the link.
- [ ] Switching the setting changes the next reference written; existing references are untouched.

## 8. Structure safety

For each of these, select part of the block and confirm the plugin explains the
limitation instead of mangling anything:

- [ ] A bulleted list item.
- [ ] A numbered list.
- [ ] A `- [ ]` task item.
- [ ] A nested list (selecting the outer item should reference the whole outer item, children included).
- [ ] A `>` blockquote.
- [ ] A Markdown table.
- [ ] A fenced code block (selecting code inside it must never insert a block ID inside the fence).
- [ ] A horizontal rule (should be reported as un-referenceable).

Then check the whole-block cases:

- [ ] Selecting a **whole list** puts the ID on its own line, below the list, with a blank line before it. In reading view, the embed renders the entire list — not just the last item.
- [ ] Selecting a **single list item** in a longer list puts the ID at the end of that item's line, and the embed renders only that item.

## 9. Headings

```markdown
# Improving relationships

I rush.

I interrupt.

# Something else

Unrelated.
```

- [ ] Selecting exactly the content under `# Improving relationships` produces a `[[Note#Improving relationships]]` reference and changes **nothing** in the source.
- [ ] The embed renders both paragraphs under that heading and stops before `# Something else`.
- [ ] With two identically named headings in one note, the plugin falls back to block IDs instead (so the link stays unambiguous).

## 10. Keyboard and edge cases

- [ ] Running the command with nothing selected shows a notice rather than doing anything.
- [ ] `Esc` in the picker changes nothing at all.
- [ ] The whole flow works without touching the mouse.
- [ ] Running the command on a note that has unsaved changes still writes the reference correctly.
