---
title: A small field guide to better words
description: Practice copyediting a real Markdown document.
---

# A small field guide to better words

Good writing gets better when you read it in the place it will live. A line feels different on a page than it does in a text editor. Here, you can make the small corrections without leaving the page.

## Start with one word

This is my **misspelled** string.

Select the bold word, then open Copyedit. The corresponding word is selected in the source editor. Make a correction and save; the Markdown keeps its double asterisks, and your preview shows the updated word.

## A few more things to try

- This sentense has a little **tpyo** tucked inside it.
- This one has an *itallic* word you can improve.
- A [helpfull link](https://docs.astro.build/) keeps its destination when you edit its label.
- Identical words are safe: **repeat** and **repeat** have separate source locations.

> Small changes deserve a short journey from noticing to fixing.

| A place for words | An invitation |
| --- | --- |
| Table cells | Make this sentance a little better. |
| Unicode | Café, naïve, 日本語, and 🌿 belong here too. |

## Code and punctuation in the source editor

Select inline code such as `const spelling = "intentional"` together with the surrounding sentence to edit the whole paragraph. Fenced code also opens in the source editor:

```js
const message = "Read me, but keep me as code.";
```

Smart punctuation such as "curly quotes", and decoded entities such as tea &amp; coffee, can be edited here too. The source editor preserves their original Markdown spelling and selects the corresponding source characters.

**A final little nudge:** read your correction once more, then carry on.
