# Astro Copyedit

Edit text where you see it. **Copyedit** adds an app to Astro's development toolbar
that saves inline copy edits back to local Markdown, MDX, and Astro template files.
It is a development-only [Astro integration](https://docs.astro.build/en/reference/integrations-reference/),
with no editor or write endpoint in production builds.

- Edit Markdown headings, paragraphs, emphasis, links, lists, asides, and tables.
- Edit MDX prose and literal JSX component children while preserving JavaScript.
- Edit literal text inside HTML elements in `.astro` pages and components.
- Keep formatting, frontmatter, code, and unrelated source bytes intact.
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

Run your site's `npm run dev`. Open **Copyedit** in the Astro toolbar at the bottom
of the preview, click highlighted text, and choose **Save to Markdown**, **Save to MDX**, or **Save
to Astro**. The preview reloads after saving. **⌘/Ctrl + Enter** saves; **Escape**
cancels the current passage. Click Copyedit again to leave editing mode.

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
collections, plus literal JSX children such as `<Aside>A small typo.</Aside>`.
Imports, exports, JavaScript expressions, frontmatter, and JSX attributes remain
read-only. Saves parse the source as MDX, preserve its component/JavaScript
structure, and escape inserted syntax as literal text. This is source editing,
not arbitrary code editing or a visual component editor.

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
  descriptions, sidebar labels, generated navigation, search UI, and code remain
  read-only. Editing a body heading updates its anchor and table of contents.
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
})
```

- `roots`: editable source directories, relative to the Astro project root.
  Defaults to `srcDir`. Real symlink targets must also be in an allowed directory.
  Only `.md`, `.mdx`, and `.astro` sources are writable.
- `locale`: editor UI language (`en` or `es`). Defaults to the browser language,
  with English for unsupported languages. This does not translate publication text.

## Editing scope

Copyedit edits **one highlighted text run at a time**. Repeated words at different
source offsets get separate mappings. Reusing a component or document shares its
source: saving a passage changes every place that source is rendered.

For Astro templates, direct text such as `<h1>A small typo</h1>` is supported,
including text around nested inline elements. JavaScript expressions, frontmatter
string literals/arrays, component props, imported values, and template elements
inside expressions such as `.map()` are read-only. There is no attempt to reverse
arbitrary JavaScript into an editable source location.

The following also remain read-only:

- Attributes (including link destinations, image alt text, and accessibility labels).
- Code, scripts, styles, SVG, MathML, form controls, and hydrated component subtrees.
- Decoded entities, Markdown escapes, smart punctuation, and transformed/generated
  text whose source spelling differs from the rendered text.
- Content without an exact, validated local source range.

Edits cannot change formatting, remove an entire passage, or insert/remove line
breaks. Existing line breaks elsewhere in a passage are retained. Inserted Markdown
punctuation and Astro-sensitive characters are escaped as literal text. Such a
passage may become read-only after saving because its source now contains escapes
or entities; use your source editor for subsequent edits to those passages.

Copyedit inserts inline spans during development. Unusually specific CSS selectors
or scripts that depend on exact child-node structure may need an opt-out. Add
`data-copyedit-ignore` to an Astro or MDX JSX element to exclude its subtree. Markdown rehype
plugins can set the same attribute before Copyedit runs. Keep valid positions when
moving Markdown nodes and remove/update positions when changing their text.

## How it works

1. A final development-only rehype pass maps unchanged Markdown and MDX text; a Vite
   transform parses `.astro` source before Astro compiles it. The Astro transform
   returns source maps. Neither transform modifies source files while rendering.
2. The server associates opaque IDs with allowed canonical paths, text ranges,
   and SHA-256 source revisions. HTML includes a relative source/line label.
3. The browser sends the ID and edited plain text to the local save endpoint.
   The server checks the revision and parses the proposed source to confirm only
   the selected text changed semantically. Unrelated source bytes stay untouched.
4. Writes are serialized per file and use a temporary file plus atomic rename,
   preserving symlinks and permissions. Content collections refresh when needed;
   the browser reloads after a successful save.

The endpoint accepts only same-origin JSON POST requests from loopback clients
with a per-session token. It never accepts client-supplied file paths. While a
passage is active, full-page HMR reloads are deferred so drafts survive external
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
