# CC Token Meter v1.3.1

Version 1.3.1 is a design release. The local dashboard has been redesigned
from the ground up for readability and clarity, in both dark and light themes.
Accounting, data, the local API, and the CLI are unchanged.

## Highlights

- **New visual system.** A coral-to-violet brand gradient, a dark-first theme
  with a matching light theme that follows your system (or the toggle), and a
  type scale where nothing is smaller than 11px.
- **Overview.** A burn chart with gradient bars, a glowing cost line and hover
  tooltips; sparklines on the KPI cards; a projected-pace meter for the 5-hour
  plan window; a gradient efficiency score ring; a five-step activity heatmap;
  and share bars on projects, subagents and tools.
- **Live session.** A new session header, a timeline with a cumulative usage
  line, and a context-window ring that shifts from teal to amber to rose as
  the context fills. Session spans of 48 hours or more read as days and hours.
- **Projects.** Cost-share bars and colour-coded what-if pricing, with cheaper
  models in teal and pricier ones in rose.
- **Insights and Settings.** Severity-coloured insight cards with savings
  pills, and settings grouped into sections with a notification toggle.
- **Motion.** Cards fade in when you switch views and numbers count up when
  they change. All motion is off when your system asks for reduced motion.

## Maintenance

- Updated the `open` dependency from 11.0.1 to 11.0.2.

## Security and privacy

The runtime contract remains unchanged:

- transcripts remain read-only input
- no prompts, tool output, usage data, or project paths are uploaded
- no telemetry or analytics
- no Anthropic API key or Anthropic API calls
- no external runtime requests; fonts are system fonts and nothing is loaded
  remotely
- dashboard binds only to `127.0.0.1`
- local API and SSE endpoints remain session-authenticated
- `open` remains the only direct production dependency

## Distribution

A maintainer-published stable GitHub Release triggers two isolated jobs:

- `cc-token-meter@1.3.1` on the public npm registry through trusted OIDC with
  provenance; and
- `@sabeekhann/cc-token-meter@1.3.1` on GitHub Packages through the
  short-lived repository token.

Pull requests and version commits do not publish either package.

## Upgrade

Run without installing:

```bash
npx --yes cc-token-meter@1.3.1
```

Or update a global installation:

```bash
npm install --global cc-token-meter@1.3.1
```

## Compatibility

- Requires Node.js 20 or newer.
- No CLI, API, configuration, or index changes; upgrading from 1.3.0 restores
  the existing local index warm.
- Windows, macOS, and Linux remain supported.
