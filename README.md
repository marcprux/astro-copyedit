# Astro Copyedit

Edit text where you see it. **Copyedit** adds an app to Astro's development toolbar
that opens the selected source in an editor panel and saves changes back to local
Markdown, MDX, and Astro template files.
It is a development-only [Astro integration](https://docs.astro.build/en/reference/integrations-reference/),
with no editor or write endpoint in production builds.

- Edit Markdown headings, paragraphs, emphasis, links, lists, asides, and tables.
- Edit MDX prose and literal JSX component children while preserving JavaScript.
- Edit literal text inside HTML elements in `.astro` pages and components.
- Edit fenced code examples and continuous selections spanning several paragraphs.
- Preserve frontmatter and unrelated source bytes while changing text and formatting.
- Detect stale edits instead of overwriting newer source changes.
- Use the same workflow in Starlight documentation sites.

Requires **Astro 7.2.3+ within version 7** and **Node.js 22.12+**. The checked-in
lockfile and CI exercise Astro 7.3 and Starlight 0.42. Earlier Astro major versions
are not supported. Markdown and MDX editing require the Unified processor.

## Installation

The initial release is prepared here but has not yet been published. Until then,
install the local checkout:

```sh
npm install -D /absolute/path/to/astro-copyedit @astrojs/markdown-remark
```

Once published, install from npm:

```sh
npm install -D astro-copyedit @astrojs/markdown-remark
```

Add Copyedit **after integrations that configure Markdown**, retaining any existing
Unified options and plugins:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import copyedit from 'astro-copyedit';

export default defineConfig({
  integrations: [copyedit()],
  markdown: { processor: unified() },
});
```

Run your site's `npm run dev`. The **Copyedit** toolbar button shows or hides the
editor overlay. Select text on the page and its Markdown or HTML source appears
in the panel. The editor follows subsequent page selections without taking focus
away from the page. Ordinary clicks, links, text selection, and copy buttons keep
their usual behavior; Copyedit adds no page highlights or editing tab stops.

For a quick correction, select text first, then press **⌘+Shift+E** on macOS or
**Ctrl+Shift+E** elsewhere. This opens and focuses the editor for the selection.
Edit the source, then press **⌘/Ctrl+Enter** or **Save to Markdown/MDX/Astro** to
save, close the overlay, and refresh the preview. **Escape**, the toolbar button,
or the toggle shortcut hides the overlay while retaining an unsaved draft.
**Cancel** explicitly discards the draft and closes the overlay.

The toolbar must be enabled (`devToolbar.enabled` must not be `false`, and the
Astro CLI toolbar preference must be enabled). Use a loopback preview URL such as
`http://localhost:4321` or `http://127.0.0.1:4321`. Copyedit does not enable editing
on deployed sites, `astro preview`, remote hosts, or reverse proxies.

Astro's `astro add astro-copyedit` command can install/register the integration
after publication; you must still configure Unified as shown above. Copyedit
reports an explanatory error for an unsupported processor instead of replacing it.

## MDX

For an ordinary Astro site, install and configure Astro's MDX integration:

```sh
npm install -D @astrojs/mdx
```

```js
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import copyedit from 'astro-copyedit';

export default defineConfig({
  integrations: [mdx(), copyedit()],
  markdown: { processor: unified() },
});
```

Keep MDX's default Markdown configuration inheritance enabled. Copyedit's rehype
pass is inherited by MDX; a separate `mdx({ processor: ... })`,
`extendMarkdownConfig: false`, or replacement MDX `rehypePlugins` list can bypass
it and leave MDX read-only. Starlight already installs MDX, so do not add a second
`mdx()` integration there.

Supported content includes Markdown text in `.mdx` page routes and local content
collections, plus literal child prose inside components such as `Aside` when it
is contained in a supported paragraph or static HTML block.
Imports, exports, JavaScript expressions, frontmatter, and component props remain
read-only. The source editor supports selected literal attributes on static HTML
elements. Saves parse the source as MDX and preserve component/JavaScript structure
outside the edited range.

## Select and edit source

Open Copyedit and select a passage or text within a code block. The panel shows
the selected Markdown or HTML source automatically. You can also select text
before opening the panel. All edits happen in the panel; rendered page elements
are never made `contenteditable`. Nothing is written until you save.

The empty overlay prompts you to select text. Selections inside the editor or
page form fields do not replace the selected source. The toggle shortcut does not
intercept typing in page inputs, textareas, selects, or editable elements.

For example, selecting any mapped text in this paragraph shows the whole paragraph:

```md
This is _some_ **bold** text and a [link](https://example.org) that I can edit in a single run.
```

Change text runs, emphasis, inline code, and link destinations together. **Edit
block** can expand the range to an enclosing list, blockquote, table, or static
HTML element when available. The preview updates after saving; the raw draft is
not rendered or executed as you type. The editor selects the source characters
corresponding to your page selection, including selections across formatting.
Repeated words use their original positions, rather than a text search.

Use **Spellcheck** above the source field to enable the browser's native spelling
checker. It starts on and remembers your choice for this site's origin across
reloads (when browser storage is available). This also applies to code fences;
Markdown syntax and code identifiers may be flagged as words. Dictionaries and
underlines depend on your browser's spelling settings. Changing the checkbox
does not alter your draft or selected source text.

### Select several paragraphs

Drag across text, or extend a selection with the keyboard, to open a continuous
source fragment. Partial selections expand to complete source blocks, preserving
their delimiters and surrounding markup. A multi-block fragment can be rewritten,
split into more paragraphs, or combined into fewer paragraphs. This works for
Markdown, MDX, and static HTML in Astro templates.

The selected blocks must come from one file, appear in source order, and form a
safe continuous range. The editor reports a limitation and disables saving when a
selection crosses files, repeated/reordered component instances, generated or
unmapped text, or unsupported component/expression boundaries. Two paragraphs
within one component can be edited together; paragraphs in separate components
are not automatically combined just because their source files match.

Only verified mapped text participates in drag selection. Markdown/MDX inline
code, decoded entities, escaped punctuation, and standard smart quotes, ellipses,
and dashes are supported. Source selections retain Markdown spelling: selecting
a rendered ampersand selects its entire `&amp;` entity. Inline `<code>` text in
Astro templates is supported too. If a verified block lacks a precise character
map, its source still opens without a word selection. The
editor accepts at most 256 mapped regions and 16,384 source characters per edit.

An unsaved draft prevents a new selection from replacing its contents; the panel
explains that the draft has been retained. Hide/reopen keeps that draft in memory
for this page session. Save or cancel it before switching to another source range.
Cancel leaves both the rendered page and source file unchanged. Stale saves
retain the draft and protect newer source changes. File bytes outside the range
and the document's line-ending convention are preserved.

Source must remain valid blocks. Imports, frontmatter, JavaScript expressions,
component elements, scripts, styles, event handlers, hydration directives, and
executable URL schemes stay outside this editor's scope. HTML accepts standard
text/layout elements and a limited set of literal attributes such as `class`,
`href`, `title`, and `aria-*`. An eligible paragraph inside an unsupported
container may still be editable. A literal text run without a safe enclosing block
(such as direct text inside an inline custom component) reports that no editable
source block is available. Generated text, localization JSON, and raw HTML
embedded in `.md` files are not mapped.

The Markdown page (`/notes/`), MDX page (`/mdx/`), and Astro template (`/astro/`)
each include the mixed-format paragraph above. Select neighboring paragraphs to
try editing a fragment.

### Fenced code examples

With the editor open, select text in a supported fenced code block to show its
source, including the opening fence, language, metadata (such as a filename),
code, and closing fence. There is no separate code-edit button. Save to regenerate
the highlighted example. Copyedit does not evaluate the code.

This works in Markdown and MDX with Astro's Shiki highlighting and Starlight's
Expressive Code. Native copy buttons keep working. Both backtick and tilde fences,
and longer delimiters for examples containing fences are supported. An empty
fence has no text to select; include it in a selection with neighboring prose.
A fence-only edit must remain one closed code fence; removing its closing delimiter
or escaping into surrounding prose is rejected. Fences may also be included in a
continuous selection with neighboring paragraphs.

Indented code and generated code components are not mapped. Inline code can be
changed within its enclosing paragraph's source. Literal HTML `pre` elements do
not currently get a source mapping. Opted-out blocks and unverified or oversized
source ranges are not editable. The Markdown, MDX, and Starlight demos include
editable fenced examples.

## Starlight

Install Copyedit and `@astrojs/markdown-remark` in your existing Starlight project.
Keep Starlight's normal content configuration and use:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import copyedit from 'astro-copyedit';

export default defineConfig({
  integrations: [
    starlight({ title: 'My documentation' }),
    copyedit(),
  ],
  markdown: { processor: unified() },
});
```

Important details:

- Add `copyedit()` to **Astro's `integrations`**, not Starlight's `plugins` list.
- Put it **after `starlight()`** and other Markdown integrations. This preserves
  Starlight's heading anchors, asides, and Expressive Code processing before
  Copyedit maps editable text.
- Explicitly select **Unified**; the Sätteri processor is not supported. Preserve
  your existing Unified plugin options when adding Copyedit.
- Regular `.md` and `.mdx` body content in `src/content/docs/` is editable. Frontmatter titles,
  descriptions, sidebar labels, generated navigation, and search UI remain
  read-only. Fenced code examples open in the source editor. Editing a body heading updates its anchor and table of contents.
- Literal MDX children inside documentation components such as `Aside` are
  editable; component attributes and expressions stay read-only. Starlight's
  optimized MDX rendering is supported. Alternative extensions such as `.mdown`
  are not supported yet.
- Starlight's docs loader is refreshed after Markdown/MDX saves. Localized documentation pages
  use the same workflow; editing one language does not change other translations.
- Starlight's installed theme files in `node_modules` are never instrumented.
  Literal text in your own `.astro` overrides can be edited within allowed roots.

The repository includes a standard Starlight example with `docsLoader()` and
`docsSchema()`, plus browser tests for paragraphs, headings, asides, code, table of
contents updates, and MDX component-child saves. See [Starlight's setup guide](https://starlight.astro.build/getting-started/).

## Try the examples

From this repository, using a current Node 22 or Node 24 release:

```sh
npm ci
npm run dev -- --background
```

Open the URL printed by Astro, normally <http://127.0.0.1:4321>. The demo navigation
switches between:

| URL | Editable source |
| --- | --- |
| `/` | `demo/src/content/articles/playground.md` — a content collection |
| `/notes/` | `demo/src/pages/notes.md` — a Markdown page route |
| `/mdx/` | `demo/src/pages/mdx.mdx` — prose and JSX children |
| `/astro/` | `demo/src/components/PracticeArticle.astro` — a template component |

These are real file edits and remain after stopping the preview. Demo interface
labels are separate from the editable publication content.

```sh
npm run dev:status
npm run dev:logs
npm run dev:stop
npm run dev:starlight -- --background
```

The Starlight example normally runs at <http://127.0.0.1:4325>. Stop it with
`cd examples/starlight && npx astro dev stop`. You can run either example in the
foreground by omitting `--background`; Astro may automatically background itself
when launched by an agent. Use the URL it prints if your preferred port is busy.

## Options

```js
copyedit({
  roots: ['./src', '../shared-docs'],
  locale: 'en',
  shortcut: 'Mod+Shift+E',
})
```

- `roots`: editable source directories, relative to the Astro project root.
  Defaults to `srcDir`. Real symlink targets must also be in an allowed directory.
  Only `.md`, `.mdx`, and `.astro` sources are writable.
- `locale`: editor UI language (`en` or `es`). Defaults to the browser language,
  with English for unsupported languages. This does not translate publication text.
- `shortcut`: chord that shows/hides the editor. Defaults to `Mod+Shift+E`, where
  `Mod` means Command on macOS and Control elsewhere. Set `false` to disable it.
  Combine `Mod`, `Ctrl`/`Control`, `Meta`/`Cmd`/`Command`, `Alt`/`Option`, and `Shift`
  with a letter, digit, or `F1`–`F12`. Letters and digits require Mod, Ctrl, Meta,
  or Alt; function keys can stand alone. Mod cannot be combined with Ctrl or Meta.
  Matching uses the browser's key value and exact modifiers. Repeated keydown,
  IME composition, and AltGraph events are ignored. Invalid chords produce a
  configuration error. Browser or OS shortcuts that never reach the page cannot
  be overridden; choose another chord if necessary.

For example, change the shortcut with `copyedit({ shortcut: 'Ctrl+Shift+K' })`,
or retain toolbar-only access with `copyedit({ shortcut: false })`.

## Editing scope

The panel edits complete source blocks or a selected continuous fragment. Repeated
words at different offsets have separate provenance. Reusing a component or
document shares its source: saving it changes every place that source is rendered.

For Astro templates, direct text such as `<h1>A small typo</h1>` is supported,
including text around nested inline elements. JavaScript expressions, frontmatter
string literals/arrays, component props, imported values, and template elements
inside expressions such as `.map()` are read-only. There is no attempt to reverse
arbitrary JavaScript into an editable source location.

Executable scripts, styles, SVG, MathML, form controls, and hydrated component
subtrees remain read-only. Arbitrary plugin-generated or transformed text with
unverified provenance is not mapped. Entities in Astro templates remain unmapped;
they can be edited within a supported block selected through another mapped word.

Copyedit inserts inline spans during development. Unusually specific CSS selectors
or scripts that depend on exact child-node structure may need an opt-out. Add
`data-copyedit-ignore` to an Astro or MDX JSX element to exclude its subtree. Markdown rehype
plugins can set the same attribute before Copyedit runs. Keep valid positions when
moving Markdown nodes and remove/update positions when changing their text.

## How it works

1. A development-only remark pass maps verified code fences before highlighting.
   A final development-only rehype pass maps unchanged Markdown and MDX text; a Vite
   transform parses `.astro` source before Astro compiles it. The Astro transform
   returns source maps. Neither transform modifies source files while rendering.
2. The server associates opaque IDs with allowed canonical paths, text ranges,
   and SHA-256 source revisions. HTML includes a relative source/line label.
3. While the overlay is open, settled page selections fetch source through the authenticated
   endpoint. For a range, the server resolves every opaque ID, checks file/revision
   identity and source order, and finds the enclosing continuous block range.
   Saving parses the proposed source and verifies that the syntax tree outside
   the range remains unchanged. Unrelated source bytes stay untouched.
4. Writes are serialized per file and use a temporary file plus atomic rename,
   preserving symlinks and permissions. Content collections refresh when needed;
   the browser reloads after a successful save.

The endpoint accepts only same-origin JSON POST requests from loopback clients
with a per-session token. It never accepts client-supplied file paths. While a
draft has unsaved changes, full-page HMR reloads are deferred (including while
the overlay is hidden) so drafts survive external
changes. A stale save is rejected; cancel and reload to get the latest source.
Native browser undo works before saving; source control/editor history handles
reverting saved changes.

Session-specific cache settings prevent cached content from retaining old mapping
IDs across restarts. `astro build` and `astro preview` install no editor, mapping
transform, or save endpoint. Production scans cover both example sites.

## Development and CI

```sh
npm ci
npx playwright install chromium
npm run validate
npm pack --dry-run
```

`validate` runs ESLint (including Astro/TypeScript), generated-localization checks,
source/save tests, browser tests, restart/base-path checks, both production builds,
a production-leak scan, and `publint`. There is no package transpilation step: the
published package contains ESM JavaScript and the public integration type declaration.
`npm run build` builds the main demo; `npm run build:starlight` builds the docs example.

Browser tests run on headless Playwright Chromium against disposable copies in
`.test-sites/`; they never edit your live demo sources. Ports 4323, 4324, and 4326
must be free. To use an installed Chrome instead:

```sh
COPYEDIT_BROWSER_CHANNEL=chrome npm run test:browser
COPYEDIT_BROWSER_CHANNEL=chrome npm run test:integration
```

GitHub Actions runs the checks on Ubuntu with Node 22 and 24, installs Chromium's
Linux dependencies, and uploads browser traces/reports on failure. CI validates
branch pushes and pull requests. Tag and release workflows reuse the same checks
for the publishing process below; no workflow creates commits or pushes tags.

UI translations live in `locales/en.json` and `locales/es.json`. Run `npm run
generate` after edits; generated accessors live in `src/generated/strings.js`.
Demo articles are publication content; test fixture prose is synthetic content.

## Publishing

Releases use **tag → GitHub prerelease → maintainer promotion → npm**.

- Pushing `v0.2.0` runs the Node 22/24 validation matrix. If it passes,
  `prerelease.yml` creates a **GitHub prerelease** with generated release notes and
  an npm tarball attached. Nothing is published to npm at this point.
- Review the prerelease, edit its notes if needed, then use GitHub's release editor
  to clear **Set as a pre-release** and save it as a full release.
- GitHub's `release: released` event starts `publish.yml`. It validates the tagged
  commit again and publishes to npm's `latest` dist-tag with trusted publishing.
  Creating a full release directly also triggers publication.

### One-time setup

1. Commit and push the reviewed files to `marcprux/astro-copyedit` when ready.
   Keep these workflows on the default branch and in the commits you tag.
2. For a brand-new npm package, make the first publication manually to establish
   the package: confirm name availability, run `npm login`, `npm run validate`,
   `npm pack --dry-run`, then `npm publish --access public` and complete npm's
   authentication prompt. Start the automated process with the **next** version;
   npm cannot publish the same version twice.
3. On npmjs.com, open **astro-copyedit → Settings → Trusted publishing**, select
   **GitHub Actions**, and enter:

   | Setting | Value |
   | --- | --- |
   | Organization or user | `marcprux` |
   | Repository | `astro-copyedit` |
   | Workflow filename | `publish.yml` |
   | Environment | Leave empty (this workflow does not use a GitHub environment) |
   | Allowed actions | Enable direct **npm publish** |

   No `NPM_TOKEN` secret is required. The publish job uses GitHub-hosted Ubuntu,
   Node 24, npm 11, and `id-token: write`. npm adds provenance automatically.
4. Allow GitHub Actions in the repository. The prerelease job requests
   `contents: write` to create the GitHub release; validation only needs read
   access. Repository/organization policy must allow that requested permission.

### Each subsequent release

1. Choose the next unused version. For example, `npm version 0.2.0 --no-git-tag-version`
   updates `package.json` and `package-lock.json` **without committing or tagging**.
2. Review and commit the version change and release contents, then push that commit.
3. Create and push the matching tag, for example `v0.2.0`.
4. Wait for **Prepare prerelease** to pass. Review the GitHub prerelease and the
   attached tarball; promote it to a full release when ready for npm publication.
5. Confirm **Publish to npm** succeeded and verify the installed npm version in a
   fresh Astro or Starlight project.

Tag names must begin with `v` and match the package and both lockfile version
fields exactly. A GitHub **prerelease** is a release status: it can use a plain
stable version such as `v0.2.0` while awaiting review. A SemVer suffix such as
`v0.2.0-rc.1` is different: it may create a GitHub prerelease, but this workflow
rejects publishing it to npm `latest`, even if someone marks it as a full release.
For a stable release, update the source version and create a new `v0.2.0` tag.

Do not move released tags or reuse published versions. Failed jobs can be rerun;
prerelease creation leaves an existing release unchanged. Once npm publication
succeeds, another publish of that version will fail rather than overwrite it.
Updating release notes does not publish again. Promotion must be done by a
maintainer (or separate app/token); GitHub normally suppresses workflow events
caused by a workflow's own `GITHUB_TOKEN`.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[GitHub release workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release).
The `astro-integration` keyword makes the published package eligible for
[Astro's integration catalog](https://docs.astro.build/en/guides/integrations/).

## License

MIT. See [LICENSE](LICENSE).
# astro-copyedit
