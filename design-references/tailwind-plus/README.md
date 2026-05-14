# Tailwind Plus reference workflow (web)

This folder stores Tailwind Plus React blocks that we use as **direct adaptation sources** for screens in `src/app/`.

## Workflow

When Prabhu shares a Tailwind Plus block:

1. **Save the raw block** here as `<block-name>.tsx`. Keep it pristine — copy-paste exactly, no edits. This is the source of truth for what we were aiming at.
2. **Open `AGENTS.md` §2** (adaptation rules) and adapt the block:
   - Headless UI primitives → shadcn `src/components/ui/` (`Card`, `Button`, `Badge`, `Dialog`, `Input`, `Label`, `Textarea`, `Avatar`)
   - Heroicons → `lucide-react` equivalents (icon names are mostly the same — `BellIcon` → `Bell`, etc.)
   - Tailwind color classes (`bg-zinc-900`, `text-gray-500`) → CSS variables from `src/app/globals.css` (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, `border-border`, `bg-accent`)
   - Hardcoded hex codes → if a token doesn't exist, **add it to globals.css first**
3. **Implement in the page file** under `src/app/<route>/page.tsx`. Keep the block reference and the production page as separate files.
4. **Refresh dev server** and compare side-by-side against this block.
5. **Commit** the production page + the reference file. The reference file is checked in so future agents can see what we were targeting.

## Naming convention

`<application-ui-category>-<block-name>.tsx`

Examples:
- `lists-stacked-list-narrow.tsx`
- `tables-stacked-on-mobile.tsx`
- `forms-action-panel-with-toggle.tsx`
- `page-examples-detail-screen-with-sidebar.tsx`
- `feedback-empty-state-with-checklist.tsx`

The category prefix matches Tailwind Plus' own sidebar so future agents can find the source block at https://tailwindcss.com/plus/ui-blocks/application-ui without guessing.

## Forbidden

- Never `import` from this folder in production code under `src/app/` or `src/components/`. References stay references.
- Never edit a saved block to "fix" it. If something needs to change for our use case, change the **adapted** production file, not the reference.
- Never check in a block without adapting and shipping the page that uses it — references should always pair with concrete output.
- Do not add Tailwind Plus blocks for screens that already exist and look good. Only add a block when a screen is being redesigned or built fresh.

## License note

Tailwind Plus is a paid subscription license held by AMASI. Per Tailwind Plus' terms, we may use the block code in our own commercial product, but we may NOT redistribute the block code itself. This repo is private, so checking in raw blocks for internal reference is fine; never share this folder externally or in a public fork.
