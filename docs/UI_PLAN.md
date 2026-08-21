# cc-token-meter v2 UI plan

## Product promise

The dashboard should help a Claude Code user answer four questions without
reading raw logs or interpreting token-accounting terminology:

1. What is happening now?
2. Where did my tokens and estimated cost go?
3. Is the current pattern healthy?
4. What is the most valuable action I can take next?

The interface is a local usage cockpit, not a billing replica. It prioritizes
current activity, explanations, comparisons, and next actions over dense raw
tables.

## Information architecture

### Overview

The default view provides a useful answer in under ten seconds:

- today’s tokens and estimated cost;
- active-session count and 15-minute burn velocity;
- cache reuse and estimated cost avoided through cache reads;
- a 14-day burn chart and 30-day forecast;
- token composition;
- top projects by estimated cost;
- the three highest-priority recommendations.

### Live session

The live view focuses on one selected session:

- project, branch, model, session age, and last activity;
- total tokens, estimated cost, message count, and current burn velocity;
- per-message token timeline with cumulative burn;
- tool-event markers for correlating large reads/outputs with spikes;
- direct navigation from a recommendation to its affected session.

When no session has been active recently, the view clearly says so and offers
the most recent session instead of displaying empty charts without context.

### Projects

The projects view supports investigation and comparison:

- search by project path;
- cost, token, session-count, and relative-share columns;
- expandable session details;
- a branch breakdown using exact per-message attribution;
- readable short names while retaining full paths in tooltips.

### Insights

The insights view turns heuristics into an action queue:

- ranked by warning level and estimated savings;
- grouped filters for all, attention, and optimization items;
- clear issue name, affected session, measured explanation, and savings;
- a “view session” action that opens the relevant timeline;
- a summary of total calculable savings without pretending that
  non-quantifiable advice has a dollar value.

### Settings

Settings are task-focused and small:

- daily token and cost budgets;
- per-session cost budget;
- warning threshold;
- save feedback and validation;
- privacy, loopback-server, and local-index explanations.

## Interaction model

- Desktop uses a persistent sidebar; mobile uses a compact horizontal view
  switcher.
- Server-Sent Events keep metrics current and visibly report connection state.
- Only the active view is re-rendered when new data arrives.
- Project search and insight filters are immediate and local.
- Budget changes are saved locally, then the summary is refetched so the UI
  updates even when no new transcript message arrives.
- Empty, loading, disconnected, and fallback-pricing states are explicit.

## Visual system

- Dark navigation rail plus a calm off-white workspace for hierarchy and
  long-session readability.
- Coral is the primary action/data color; teal represents healthy/local/live
  states; amber and red are reserved for attention and exceeded states.
- System fonts only, so the dashboard remains fully offline.
- Cards use consistent 16–20px radii, subtle borders, and restrained shadows.
- Numbers use tabular alignment; project/session identifiers use monospace.
- Charts include text summaries and do not rely on color alone.

## Accessibility and privacy requirements

- Keyboard-operable navigation, filters, forms, and expandable rows.
- Visible focus states and semantic headings/labels.
- Minimum 44px touch targets on compact screens.
- Dynamic text is escaped before insertion into generated markup.
- No remote fonts, scripts, images, analytics, or telemetry.
- The server remains bound to `127.0.0.1` and uses a restrictive CSP.

## Acceptance criteria

- The four product questions are answerable from the dashboard without opening
  JSON output.
- Every displayed number maps to an existing summary field or a documented
  client-side calculation.
- All four primary views work at 1440px, 1024px, 768px, and 390px widths.
- The dashboard remains useful with zero sessions, one session, and large
  histories.
- Search, filters, session navigation, budget saving, SSE reconnection, and
  mobile navigation are manually verified.
- The README contains a screenshot captured from the actual implementation
  using clearly synthetic data.
