# Evergreen Refactor

Turn freeform writing into structured, interconnected notes — *after* you've written it, not before.

Select a passage in a daily note or mind dump, run one command, pick one or more notes to send it to, and Obsidian gets a native block reference. The original text stays exactly where you wrote it and stays canonical; every reference points back at it.

```markdown
![[2026.10.16#^20261016-164300-a7c9]]
```

Nothing is copied. Edit the original passage and every note that embeds it updates.

---

## Why

There are two ways to build a knowledge base, and most tools only support one:

1. **Topic first.** Create `Improving relationships`, then write into it.
2. **Dump first.** Write freely in a daily note, then discover that one paragraph belongs in three different evergreen notes.

[Note Composer](https://help.obsidian.md/plugins/note-composer), Obsidian's built-in core plugin, handles the second case by *extracting* a passage into a new note — it moves the text and leaves a link behind. That's a good fit when a passage belongs in exactly one place.

Evergreen Refactor covers the case Note Composer doesn't: a passage that belongs in **several** notes at once, and that you want to keep in its original context. It extends the same idea with native block references and embeds, so nothing is duplicated and nothing is moved.

## What it is not

- Not a separate knowledge-management system. It writes plain `[[wiki links]]` and `![[embeds]]` that Obsidian already understands.
- Not a note splitter. It never moves, rewrites or reformats your prose.
- Not a folder organiser, tagger, or graph view. It does one thing.

---

## Install

### From a release (manual)

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest).
2. In Obsidian, open **Settings → About → Vault path** and click the folder icon to reveal your vault in Finder / Explorer.
3. Open the `.obsidian/plugins/` folder. Create a folder named `evergreen-refactor` if it isn't there.
4. Copy the three files into it.
5. In Obsidian, go to **Settings → Community plugins**, click the reload button, and enable **Evergreen Refactor**.

### From source

See [Local development](#local-development) below.

---

## Use

1. Select a passage in any note. A whole paragraph is the common case; see [Selections](#selections) for the rest.
2. Open the command palette (`Cmd/Ctrl+P`) and run **Evergreen Refactor: Reference selection in another note…**.
3. A picker opens. Type to search your notes, press `Enter` to add one, and repeat for as many destinations as you like. Type a name that doesn't exist yet and it's offered as **Create "…"**.
4. Press `Cmd/Ctrl+Enter` (or click the button) to confirm.
5. The source note gets a timestamped block ID, and each destination note gets the reference.

Assign a keyboard shortcut under **Settings → Hotkeys** — search for "Evergreen Refactor".

### The picker

| Key | Action |
| --- | --- |
| Type | Filter notes, or start a new note name |
| `↑` `↓` | Move through the list |
| `Enter` | Add or remove the highlighted note |
| `Cmd/Ctrl+Enter` | Confirm and write the references |
| `Esc` | Cancel without changing anything |

Existing references are never duplicated. Running the same operation twice is safe: if a destination note already points at that block, it is left alone. If the passage already has a block ID, that ID is reused rather than a second one being added.

---

## Reference display

One setting, **Settings → Evergreen Refactor → Reference display**:

| Setting | What the destination note gets |
| --- | --- |
| **Full embedded passage** *(default)* | `![[2026.10.16#^20261016-164300-a7c9]]` |
| **Short clickable preview** | `[[2026.10.16#^20261016-164300-a7c9\|I keep noticing that…]]` |
| **Both** | A readable link, then the full embed |

The preview text is generated from the first few words of the selection. Markup is stripped and characters that would break a link alias (`|`, `[`, `]`) are removed.

There is also a **Folder for new notes** setting, which decides where notes created from the picker live. Leave it empty for the vault root.

---

## Selections

Obsidian can address a **block** — a paragraph, list item, list, blockquote, table, or fenced code block — and a **heading section**. It cannot address part of one. Evergreen Refactor is honest about that boundary instead of guessing.

| You select | What happens |
| --- | --- |
| A complete paragraph | A block ID is appended to the end of the paragraph. |
| A complete list item | A block ID is appended to the end of that item — not the whole list. |
| A whole list | The block ID goes on its own line below the list, with a blank line before it (that blank line is what binds it to the list rather than the last item). |
| A whole blockquote, table, or code block | The block ID goes on its own line after the block. |
| A heading, or exactly the content under one | A section reference (`[[Note#Heading]]`). Nothing in the source note changes. |
| Several complete paragraphs | One reference per paragraph, so the reference is exactly what you selected rather than something wider. |
| **Part of a paragraph** | A prompt explains that Obsidian can only reference whole paragraphs, and offers to reference the whole paragraph or to split the paragraph around your selection. |
| **Part of a list item, table, quote or code block** | A prompt offers to reference the enclosing item or block. Splitting is never offered for these, because it would damage the structure. |

Anything that cannot be referenced — a horizontal rule, or a selection of only whitespace — is reported instead of silently altered.

A block ID looks like `20261016-164300-a7c9`: a local timestamp plus a short random suffix. The timestamp makes a raw mind dump's block IDs read as a rough timeline of when each passage was promoted into structure, and it keeps IDs valid and unique.

---

## Local development

Requires **Node 22.18 or newer** (Node 24 LTS recommended). The test files are TypeScript, which Node runs directly — no build step or test framework needed.

```bash
git clone https://github.com/Avery2/evergreen-refactor.git
cd evergreen-refactor
npm install
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Rebuild `main.js` on every change (esbuild watch). |
| `npm run build` | Production build. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Run the unit tests. |
| `npm run verify` | Load the built `main.js` with a stubbed Obsidian and check the manifest. |
| `npm run check` | All of the above, in order. |
| `npm run install:vault -- --vault "<path>"` | Build, then copy into a vault. |
| `npm run dev:vault -- --vault "<path>"` | Build, copy, and rebuild on every change. |

### Installing into your vault

The install script never guesses. It needs to be told which vault to write to, and it refuses to write anywhere that doesn't contain a `.obsidian` folder. It only ever copies files — nothing is deleted, and your plugin settings (`data.json`) are left alone.

```bash
# See the vaults Obsidian already knows about on this machine
node scripts/install.mjs --list

# Check what would happen without writing anything
node scripts/install.mjs --vault "/path/to/My Vault" --dry-run

# Build and install
npm run install:vault -- --vault "/path/to/My Vault"

# Or set it once and forget it
export OBSIDIAN_VAULT="/path/to/My Vault"
npm run install:vault
```

You can also use `npm run dev:vault -- --vault "…"`, which keeps watching and re-copies `main.js` into the vault on every save.

### Reloading after a rebuild

Obsidian caches the plugin bundle. After the files are copied, either:

- Run the **Reload app without saving** command from the command palette (`Cmd/Ctrl+P`), or
- Toggle the plugin off and on in **Settings → Community plugins**.

### Disabling or uninstalling

- **Disable:** **Settings → Community plugins → Evergreen Refactor** → toggle off. Your settings are kept.
- **Uninstall:** toggle it off, click the trash icon next to it in the same list, then confirm. This removes the plugin folder from `.obsidian/plugins/`. It does **not** touch any notes — the block IDs and links it created are ordinary Markdown and stay valid.
- **Remove it by hand:** delete `<vault>/.obsidian/plugins/evergreen-refactor/`.

Block IDs left behind in your notes are harmless if you stop using the plugin. They are normal Obsidian block IDs and render as nothing.

---

## Design

The whole plugin is built around one constraint: **the original note is canonical, and the plugin is only allowed to mark a passage as addressable.**

That falls out into a few rules:

- Never move, reword, or reformat prose. The only source edit is adding a block ID (or, when explicitly chosen, inserting blank lines to split a paragraph).
- Never guess when Obsidian's model can't express what was asked. Ask, explain the trade-off, and let the user cancel.
- Prefer native syntax over a bespoke scheme, so the notes remain useful without the plugin.
- Prefer a heading section reference over several block IDs when the selection is exactly a section, since that's what Obsidian already means by `[[Note#Heading]]`.
- Never duplicate a reference that already exists.

The analysis is a pure function of the document text and the selection range (`src/selection-plan.ts`), which is why the interesting behaviour is testable without Obsidian running. See [docs.md](docs.md) for the underlying Obsidian behaviour this is built on.

## Known limitations

- **Obsidian cannot reference part of a block.** This is an Obsidian limitation, not a plugin one. The plugin offers a widening or splitting fallback rather than pretending otherwise.
- **Splitting a paragraph changes its structure** (never its wording). It is offered only for plain paragraphs, is clearly labelled, and is a single `Cmd/Ctrl+Z` to undo.
- **Heading section references grow** if you later add content to that section. Use block references when you want a passage pinned exactly.
- **A heading inside a multi-paragraph selection is skipped**, with an explanation, because a section reference would pull in more than the selection.
- **Note names containing `#`, `^`, `|`, `[` or `]` are refused**, because Obsidian cannot put them inside a wiki link. The plugin explains this rather than writing a broken link.
- Block IDs are generated from your system clock in local time. If two machines write to the same note in the same second, the random suffix is what keeps them apart.

## License

[MIT](LICENSE)
