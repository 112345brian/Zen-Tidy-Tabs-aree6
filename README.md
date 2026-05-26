# Zen-Tidy-Tabs (112345brian fork)

A fork of [aree6/Zen-Tidy-Tabs](https://github.com/aree6/Zen-Tidy-Tabs) with fixes for Sine compatibility and new auto-sort behaviour.

## What's different from upstream

### Fix — Sine module loader compatibility
Sine's `module_loader.mjs` only processes files ending in `.uc.mjs`. The original scripts were named `.uc.js` and silently ignored after installation, causing the mod to do nothing. Both `tab-grouping` and `tree-connectors` scripts are renamed accordingly, with `theme.json` updated to match.

### Fix — zen-folder header alignment
Zen's native `zen-folder` element uses `pack="center"` on its label container, causing group headers to render horizontally centered. Overridden in CSS so they appear left-aligned.

### Feature — auto-sort on tab open/close
A debounced listener fires `sortTabsByTopic()` whenever a tab opens or closes. Already-grouped tabs are never reshuffled (`includeGrouped: false`). Off by default — enable via the mod's preference panel.

| Preference | Type | Default | Description |
|---|---|---|---|
| `zen.tidytabs.behavior.auto-sort-on-new-tab` | bool | `false` | Enable auto-sort on tab open/close |
| `zen.tidytabs.behavior.auto-sort-debounce-ms` | number | `5000` | Delay in ms before sort fires after last tab change |

### Feature — inline auto-sort toggle button
An optional clock icon on the pinned/normal separator lets you arm or disarm auto-sort without opening preferences. Gets a subtle background tint when active.

| Preference | Type | Default | Description |
|---|---|---|---|
| `zen.tidytabs.ui.show-auto-sort-toggle` | bool | `false` | Show the toggle button on the separator |

## Installation

Install via [Sine](https://github.com/zen-browser/sine) using this fork's `personal` branch:

```
https://github.com/112345brian/Zen-Tidy-Tabs-aree6/tree/personal
```

## Branch structure

| Branch | Purpose |
|---|---|
| `main` | Clean mirror of upstream (`aree6/Zen-Tidy-Tabs`) |
| `personal` | This fork's patches, rebased on top of `main` |

To sync with upstream:
```bash
git fetch upstream
git switch main && git merge upstream/main && git push origin main
git switch personal && git rebase main && git push origin personal --force-with-lease
```

## Pull request

Changes are proposed upstream at [aree6/Zen-Tidy-Tabs#3](https://github.com/aree6/Zen-Tidy-Tabs/pull/3).
