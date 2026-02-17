# Inkdrop Features vs NoteHub — Gap Analysis

A complete audit of Inkdrop's feature set and where NoteHub currently stands.

---

## ✅ Features NoteHub Already Has

| Feature | Notes |
|---|---|
| Notebook organization | Multi-notebook with icons |
| Markdown editor | Edit / Split / Preview modes |
| Live markdown preview | Rendered in real-time |
| Syntax highlighting | Via neovim-editor plugin |
| Local-first storage | All data stored on device |
| Plugin system | JS-based plugin API |
| Export to Markdown | File export |
| Import Markdown | File import |
| Search | Basic sidebar + Advanced Search plugin |
| Math rendering | KaTeX plugin |
| DOCX import | docx-converter plugin |
| Excel import | excel-integration plugin |
| Vim keybindings | neovim-editor plugin |
| Configurable theme | Catppuccin Mocha + accent colors |
| GUI Preferences window | Font picker, plugin toggles, etc. |
| Auto-save | Configurable interval |
| Keyboard shortcuts | Cmd+N, Cmd+1/2/3, etc. |
| Cross-platform | macOS, Linux, Windows via Electron |
| Integrated terminal | terminal plugin |

---

## ❌ Features Inkdrop Has That NoteHub Is Missing

### 🔴 High Priority (Most Useful)

#### 1. **Tags**
Inkdrop lets you tag notes with multiple labels and filter by tag.
Very useful for cross-notebook organization.
- NoteHub has no tagging system at all
- Would need: tag UI on note items, tag filter in sidebar, tag storage in note data

#### 2. **Note Status** (Active / Archived / Trash)
Notes in Inkdrop can be set to Active, On Hold, Dropped, Completed, or Trash.
- NoteHub has no note lifecycle states — deletion is permanent
- Would need: status field on notes, trash/archive view, restore from trash

#### 3. **Full-text Search with Filters**
Inkdrop search supports filtering by notebook, tag, status, and date range from a unified search bar.
- NoteHub's advanced-search plugin is basic — no date range, no tag filter

#### 4. **Pin Notes**
Pin important notes to the top of the list.
- NoteHub has no pinning — notes are in creation order only

#### 5. **Note Sorting**
Sort notes by: Updated date, Created date, Title (A-Z), File size.
- NoteHub currently has no sort controls

#### 6. **Mermaid Diagram Rendering**
Inkdrop renders Mermaid diagrams (flowcharts, sequence diagrams, Gantt charts) inside the preview.
- NoteHub has no diagram support

#### 7. **Table of Contents (TOC) sidebar**
When viewing a note, Inkdrop shows a TOC panel based on headings.
- NoteHub has no TOC — useful for long documents

#### 8. **Code Block Syntax Highlighting in Preview**
Inkdrop highlights code blocks in the preview pane by language.
- NoteHub's preview doesn't syntax-highlight fenced code blocks

#### 9. **Word Count / Reading Time**
Status bar shows word count and estimated reading time.
- NoteHub's status bar only shows position/note count

#### 10. **Note Templates**
Create template notes that pre-fill new notes with structure.
- NoteHub has no template system

---

### 🟡 Medium Priority (Nice to Have)

#### 11. **Distraction-Free / Focus Mode**
Hides the sidebar and toolbar, leaving only the editor centered on screen.
- NoteHub has no focus/zen mode

#### 12. **Split Notebook View**
View two notes side by side.
- NoteHub only shows one note at a time

#### 13. **Note History / Revisions**
Inkdrop keeps a local history of edits so you can roll back.
- NoteHub has no revision history

#### 14. **Drag and Drop Notes Between Notebooks**
Drag a note from one notebook to another in the sidebar.
- NoteHub requires editing the note to change notebooks

#### 15. **Notebook Nesting / Hierarchy**
Inkdrop supports sub-notebooks (e.g., Work > Projects > Website).
- NoteHub has flat notebooks only

#### 16. **Custom CSS Theming**
Inkdrop lets users inject custom CSS for the preview pane.
- NoteHub has config-based theming but no user CSS injection

#### 17. **PDF Export**
Export notes as formatted PDFs.
- NoteHub can only export to Markdown

#### 18. **Print Support**
Print notes with proper styling.
- NoteHub has no print support

#### 19. **Multi-cursor Editing**
Multiple cursors via Alt+Click or keyboard shortcuts.
- Available in neovim-editor via Visual Block but not in default editor

#### 20. **Note Sharing via URL**
Inkdrop (with cloud) can generate a public URL for a note.
- NoteHub is local-only, no sharing

---

### 🟢 Lower Priority (Power User Features)

#### 21. **Markdown Footnotes**
`[^1]` footnote syntax rendered in preview.
- Not currently supported

#### 22. **Front Matter / YAML Metadata**
YAML front matter in notes for metadata like `date`, `author`, `tags`.
- Not currently supported

#### 23. **Image Paste**
Paste an image from clipboard directly into a note (saved locally).
- NoteHub has no image paste support

#### 24. **Image Drag and Drop into Notes**
Drag image files onto the editor to embed them.
- Not supported

#### 25. **Wikilinks** (`[[Note Name]]`)
Link between notes using double-bracket syntax, like Obsidian.
- Not supported — useful for knowledge base / Zettelkasten workflows

#### 26. **Graph View**
Visual map of how notes link to each other (Obsidian-style).
- Not supported

#### 27. **Command Palette** (`Cmd+P`)
Fuzzy-search all commands, notes, and actions from a single popup.
- NoteHub has no command palette

#### 28. **Quick Note Capture**
Global keyboard shortcut to capture a note from anywhere on the system.
- Not supported (would need OS-level shortcut)

#### 29. **Typewriter Mode**
Keeps the current line centered in the editor while typing.
- Not supported

#### 30. **Presentation Mode**
View a note as a slide presentation.
- Not supported

---

## 🛠️ Recommended Plugins to Build Next

Based on the gap analysis, here's a prioritized build list:

### Sprint 1 — Core gaps
```
plugin: tags           — add/remove tags, filter sidebar by tag
plugin: note-status    — Active / Archive / Trash lifecycle  
plugin: note-sorting   — sort notes by date/title/size
plugin: pin-notes      — pin to top of note list
plugin: note-templates — template selector on new note
```

### Sprint 2 — Editor enhancements
```
plugin: mermaid        — render Mermaid diagrams in preview
plugin: code-highlight — syntax highlight fenced code in preview (highlight.js)
plugin: toc-panel      — Table of Contents from headings
plugin: word-count     — word count + reading time in status bar
plugin: focus-mode     — hide sidebar, center editor (Cmd+Shift+F)
```

### Sprint 3 — Power user
```
plugin: image-paste    — clipboard image → saved file → embedded markdown
plugin: wikilinks      — [[Note Name]] → click to navigate
plugin: pdf-export     — export note as PDF
plugin: note-history   — local edit history with diff view
plugin: command-palette — Cmd+P fuzzy launcher for all actions
```

### Sprint 4 — Advanced
```
plugin: yaml-front-matter — parse and display YAML metadata
plugin: notebook-nesting  — sub-notebooks in sidebar
plugin: custom-css        — user CSS injected into preview
plugin: typewriter-mode   — centered typing line
plugin: graph-view        — wikilink relationship graph
```

---

## 💡 Quick Wins (Can be added without full plugins)

These could be added directly to the core app in an afternoon:

1. **Note sorting dropdown** in the "All Notes" header (sort by date/title)
2. **Pin notes** with a star icon that bumps them to the top
3. **Word count in status bar** — just count `content.split(/\s+/).length`
4. **Code highlighting in preview** — add `highlight.js` to the preview renderer
5. **Trash / soft delete** — move notes to a `status: 'trash'` state instead of deleting
6. **Note templates** — a "templates" notebook that pre-fills new notes
7. **Drag notes between notebooks** — HTML drag events on note items

---

## 🔑 The Biggest Single Missing Feature

**Tags** — Inkdrop's tag system is what makes large note collections manageable. Without tags, users are stuck with folder-only organization which doesn't scale. It's the #1 thing to add next.

**Wikilinks** — If NoteHub wants to appeal to knowledge-management / second-brain users (Obsidian audience), `[[Note Name]]` linking is essential.

**Command Palette** — Once there are 10+ plugins and features, discoverability becomes a problem. A `Cmd+P` command palette solves this elegantly.
