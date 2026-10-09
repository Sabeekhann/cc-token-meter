(function () {
  'use strict';

  var VIEW_TITLES = {
    overview: 'Overview',
    live: 'Live session',
    projects: 'Projects',
    insights: 'Insights',
    settings: 'Settings'
  };

  var THEME_KEY = 'cc-token-meter.theme';
  var NOTIFY_KEY = 'cc-token-meter.notify';
  var NOTIFIED_KEY = 'cc-token-meter.notified';
  var NOTIFIED_TTL_MS = 3 * 24 * 60 * 60 * 1000;
  var DEFAULT_CONTEXT_WINDOW = 200000;
  var EXTENDED_CONTEXT_WINDOW = 1000000;
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var VIEW_SHORTCUTS = { o: 'overview', l: 'live', p: 'projects', i: 'insights', s: 'settings' };

  applyTheme(readStoredTheme());

  var TIP_KINDS = [
    { prefix: 'repeatedReads', icon: '↻', label: 'Repeated file reads' },
    { prefix: 'cacheRatio', icon: '◐', label: 'Cache reuse dropped' },
    { prefix: 'longSessionNoCompact', icon: '⌁', label: 'Context needs attention' },
    { prefix: 'outlierSessionTotal', icon: '↑', label: 'Unusually large session' },
    { prefix: 'largeToolResultSpike', icon: '▣', label: 'Large tool output' }
  ];

  var state = {
    summary: null,
    view: 'overview',
    insightFilter: 'all',
    projectQuery: '',
    projectSummary: null,
    projectSummaryKey: null,
    projectRange: 'all',
    projectModel: '',
    projectFrom: '',
    projectTo: '',
    projectLoading: false,
    projectError: '',
    projectRefreshTimer: null,
    projectRequestId: 0,
    expandedProject: null,
    selectedSessionId: null,
    whatIfProject: '',
    whatIfOptionsKey: '',
    settingsHydrated: false,
    toastTimer: null,
    notifyEnabled: false,
    notified: {},
    paletteItems: [],
    paletteIndex: 0,
    paletteReturnFocus: null,
    pendingGoKey: false,
    pendingGoTimer: null,
    burnDays: [],
    countUps: {},
    overviewResizeTimer: null
  };

  var dom = {
    viewTitle: byId('viewTitle'),
    connectionStatus: byId('connectionStatus'),
    lastUpdated: byId('lastUpdated'),
    liveNavDot: byId('liveNavDot'),
    insightNavCount: byId('insightNavCount'),
    projectSearch: byId('projectSearch'),
    projectModel: byId('projectModel'),
    projectFrom: byId('projectFrom'),
    projectTo: byId('projectTo'),
    customRangeFields: byId('customRangeFields'),
    projectFilterSummary: byId('projectFilterSummary'),
    clearProjectFilters: byId('clearProjectFilters'),
    budgetForm: byId('budgetForm'),
    toast: byId('toast'),
    themeToggle: byId('themeToggle'),
    paletteTrigger: byId('paletteTrigger'),
    paletteBackdrop: byId('paletteBackdrop'),
    paletteInput: byId('paletteInput'),
    paletteList: byId('paletteList')
  };

  hydrateProjectFilterState();
  bindNavigation();
  bindFilters();
  bindSettings();
  bindTheme();
  bindNotifications();
  byId('downloadReport').addEventListener('click', function () { downloadWeeklyReport(false); });
  byId('downloadReportNames').addEventListener('click', function () { downloadWeeklyReport(true); });
  bindPalette();
  bindShortcuts();
  bindOverviewCharts();
  connect();

  function byId(id) {
    return document.getElementById(id);
  }

  function readStoredTheme() {
    try {
      var stored = window.localStorage.getItem(THEME_KEY);
      return stored === 'light' || stored === 'dark' ? stored : null;
    } catch {
      return null;
    }
  }

  function applyTheme(theme) {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }

  function effectiveTheme() {
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function bindTheme() {
    syncThemeToggle();
    dom.themeToggle.addEventListener('click', toggleTheme);
    if (window.matchMedia) {
      var query = window.matchMedia('(prefers-color-scheme: dark)');
      if (query.addEventListener) query.addEventListener('change', syncThemeToggle);
    }
  }

  function toggleTheme() {
    var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Theme still applies for this page view when storage is unavailable.
    }
    syncThemeToggle();
  }

  function syncThemeToggle() {
    var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    dom.themeToggle.setAttribute('aria-label', 'Switch to ' + next + ' theme');
    dom.themeToggle.title = 'Switch to ' + next + ' theme';
    dom.themeToggle.innerHTML = next === 'light'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" /></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>';
  }

  function bindPalette() {
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    var hint = dom.paletteTrigger.querySelector('kbd');
    if (hint && !isMac) hint.textContent = 'Ctrl K';
    dom.paletteTrigger.addEventListener('click', openPalette);
    dom.paletteInput.addEventListener('input', function () {
      state.paletteIndex = 0;
      renderPalette();
    });
    dom.paletteInput.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        var count = state.paletteItems.length;
        if (count === 0) return;
        state.paletteIndex = (state.paletteIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
        renderPalette(true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        runPaletteItem(state.paletteItems[state.paletteIndex]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
      } else if (event.key === 'Tab') {
        // The input is the only focusable control inside the modal dialog.
        event.preventDefault();
      }
    });
    dom.paletteBackdrop.addEventListener('mousedown', function (event) {
      if (event.target === dom.paletteBackdrop) closePalette();
    });
    dom.paletteList.addEventListener('click', function (event) {
      var item = event.target.closest('[data-palette-index]');
      if (item) runPaletteItem(state.paletteItems[Number(item.getAttribute('data-palette-index'))]);
    });
  }

  function paletteOpen() {
    return !dom.paletteBackdrop.classList.contains('hidden');
  }

  function openPalette() {
    if (paletteOpen()) return;
    state.paletteReturnFocus = document.activeElement;
    state.paletteIndex = 0;
    dom.paletteInput.value = '';
    dom.paletteBackdrop.classList.remove('hidden');
    renderPalette();
    dom.paletteInput.focus();
  }

  function closePalette() {
    if (!paletteOpen()) return;
    dom.paletteBackdrop.classList.add('hidden');
    var target = state.paletteReturnFocus;
    state.paletteReturnFocus = null;
    if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
  }

  function paletteCommands() {
    var commands = Object.keys(VIEW_TITLES).map(function (view) {
      return { label: 'Go to ' + VIEW_TITLES[view], hint: 'View', run: function () { setView(view, true, true); } };
    });
    commands.push({
      label: 'Switch to ' + (effectiveTheme() === 'dark' ? 'light' : 'dark') + ' theme',
      hint: 'Appearance',
      run: toggleTheme
    });
    var summary = state.summary || {};
    (Array.isArray(summary.byProject) ? summary.byProject.slice() : [])
      .sort(function (a, b) { return finiteOr0(b.costUsd) - finiteOr0(a.costUsd); })
      .slice(0, 25)
      .forEach(function (project) {
        commands.push({
          label: shortProjectName(project.project),
          hint: 'Project · ' + formatCost(project.costUsd || 0),
          search: String(project.project || ''),
          run: function () {
            dom.projectSearch.value = lastPathSegment(project.project);
            state.projectQuery = dom.projectSearch.value.toLowerCase();
            setView('projects', true, true);
          }
        });
      });
    (Array.isArray(summary.sessions) ? summary.sessions.slice() : [])
      .sort(function (a, b) { return timestampOf(b.lastTimestamp) - timestampOf(a.lastTimestamp); })
      .slice(0, 15)
      .forEach(function (session) {
        commands.push({
          label: shortProjectName(session.project) + ' · ' + String(session.sessionId || '').slice(0, 8),
          hint: 'Session · ' + formatRelative(session.lastTimestamp, summary.generatedAt),
          search: String(session.sessionId || '') + ' ' + String(session.gitBranch || ''),
          run: function () {
            state.selectedSessionId = session.sessionId;
            setView('live', true, true);
          }
        });
      });
    return commands;
  }

  function renderPalette(keepItems) {
    if (!keepItems) {
      var query = dom.paletteInput.value.trim().toLowerCase();
      state.paletteItems = paletteCommands().filter(function (command) {
        if (!query) return true;
        return (command.label + ' ' + command.hint + ' ' + (command.search || '')).toLowerCase().indexOf(query) !== -1;
      }).slice(0, 30);
      state.paletteIndex = Math.min(state.paletteIndex, Math.max(0, state.paletteItems.length - 1));
    }
    if (state.paletteItems.length === 0) {
      dom.paletteList.innerHTML = '<li class="palette-empty">No matching views, projects, or sessions.</li>';
      dom.paletteInput.removeAttribute('aria-activedescendant');
      return;
    }
    dom.paletteList.innerHTML = state.paletteItems.map(function (command, index) {
      return '<li id="palette-item-' + index + '" class="palette-item" role="option" data-palette-index="' + index + '" aria-selected="' + (index === state.paletteIndex) + '">' +
        '<span>' + escapeHtml(command.label) + '</span><small>' + escapeHtml(command.hint) + '</small></li>';
    }).join('');
    dom.paletteInput.setAttribute('aria-activedescendant', 'palette-item-' + state.paletteIndex);
    var active = byId('palette-item-' + state.paletteIndex);
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function runPaletteItem(command) {
    if (!command) return;
    closePalette();
    command.run();
  }

  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    var tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function bindShortcuts() {
    document.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && String(event.key).toLowerCase() === 'k') {
        event.preventDefault();
        if (paletteOpen()) closePalette();
        else openPalette();
        return;
      }
      if (paletteOpen() || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;

      if (state.pendingGoKey) {
        state.pendingGoKey = false;
        window.clearTimeout(state.pendingGoTimer);
        var view = VIEW_SHORTCUTS[String(event.key).toLowerCase()];
        if (view) {
          event.preventDefault();
          setView(view, true, true);
        }
        return;
      }
      if (event.key === 'g') {
        state.pendingGoKey = true;
        state.pendingGoTimer = window.setTimeout(function () { state.pendingGoKey = false; }, 1200);
      } else if (event.key === '/') {
        event.preventDefault();
        if (state.view !== 'projects') setView('projects', true, false);
        dom.projectSearch.focus();
      }
    });
  }

  function bindNavigation() {
    var navButtons = Array.from(document.querySelectorAll('[data-view]'));
    navButtons.forEach(function (button, index) {
      button.addEventListener('click', function () {
        setView(button.getAttribute('data-view'), true, true);
      });
      button.addEventListener('keydown', function (event) {
        var targetIndex = keyboardTargetIndex(event.key, index, navButtons.length);
        if (targetIndex == null) return;
        event.preventDefault();
        navButtons[targetIndex].focus();
      });
    });

    document.querySelectorAll('[data-go-view]').forEach(function (button) {
      button.addEventListener('click', function () {
        setView(button.getAttribute('data-go-view'), true, true);
      });
    });

    document.querySelectorAll('[data-nav-view]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        setView(link.getAttribute('data-nav-view'), true, true);
      });
    });

    window.addEventListener('hashchange', function () {
      var requested = window.location.hash.replace('#', '');
      if (VIEW_TITLES[requested] && requested !== state.view) {
        setView(requested, false, true);
      }
    });

    var initialView = window.location.hash.replace('#', '');
    if (VIEW_TITLES[initialView]) setView(initialView, false);
  }

  function bindFilters() {
    dom.projectSearch.addEventListener('input', function () {
      state.projectQuery = dom.projectSearch.value.trim().toLowerCase();
      if (state.view === 'projects') renderProjects();
    });

    var rangeButtons = Array.from(document.querySelectorAll('[data-project-range]'));
    rangeButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        state.projectRange = button.getAttribute('data-project-range') || 'all';
        if (state.projectRange !== 'custom') {
          state.projectFrom = '';
          state.projectTo = '';
        }
        projectFiltersChanged();
      });
    });

    dom.projectModel.addEventListener('change', function () {
      state.projectModel = dom.projectModel.value;
      projectFiltersChanged();
    });
    dom.projectFrom.addEventListener('change', function () {
      state.projectFrom = dom.projectFrom.value;
      projectFiltersChanged();
    });
    dom.projectTo.addEventListener('change', function () {
      state.projectTo = dom.projectTo.value;
      projectFiltersChanged();
    });
    byId('whatIfProject').addEventListener('change', function (event) {
      state.whatIfProject = event.target.value;
      renderProjects();
    });
    dom.clearProjectFilters.addEventListener('click', function () {
      state.projectRange = 'all';
      state.projectModel = '';
      state.projectFrom = '';
      state.projectTo = '';
      state.projectError = '';
      projectFiltersChanged();
    });

    var filterButtons = Array.from(document.querySelectorAll('[data-insight-filter]'));
    filterButtons.forEach(function (button, index) {
      button.addEventListener('click', function () {
        state.insightFilter = button.getAttribute('data-insight-filter');
        filterButtons.forEach(function (item) {
          item.classList.toggle('active', item === button);
          item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
        });
        renderInsights();
      });
      button.addEventListener('keydown', function (event) {
        var targetIndex = keyboardTargetIndex(event.key, index, filterButtons.length);
        if (targetIndex == null) return;
        event.preventDefault();
        filterButtons[targetIndex].focus();
        filterButtons[targetIndex].click();
      });
    });
  }

  function keyboardTargetIndex(key, currentIndex, length) {
    if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % length;
    if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + length) % length;
    if (key === 'Home') return 0;
    if (key === 'End') return length - 1;
    return null;
  }

  function bindSettings() {
    dom.budgetForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var submitButton = dom.budgetForm.querySelector('button[type="submit"]');
      var status = byId('budgetFormStatus');
      var payload = {
        dailyTokenCap: inputNumberOrNull('dailyTokenCap'),
        dailyCostCapUsd: inputNumberOrNull('dailyCostCapUsd'),
        sessionCostCapUsd: inputNumberOrNull('sessionCostCapUsd'),
        monthlyCostCapUsd: inputNumberOrNull('monthlyCostCapUsd'),
        monthlyTokenCap: inputNumberOrNull('monthlyTokenCap'),
        warnThresholdPct: inputNumberOrNull('warnThresholdPct') || 80,
        plan: byId('planSelect').value,
        planMonthlyUsd: inputNumberOrNull('planMonthlyUsd'),
        blockTokenLimit: inputNumberOrNull('blockTokenLimit'),
        weeklyTokenLimit: inputNumberOrNull('weeklyTokenLimit')
      };

      submitButton.disabled = true;
      status.className = '';
      status.textContent = 'Saving locally…';

      try {
        var response = await fetch('/api/budget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Settings request failed');

        var summaryResponse = await fetch('/api/summary', { cache: 'no-store' });
        if (!summaryResponse.ok) throw new Error('Could not refresh the dashboard');
        receiveSummary(await summaryResponse.json());

        status.className = 'success';
        status.textContent = 'Saved on this machine.';
        showToast('Budget settings saved locally.');
      } catch (error) {
        status.className = 'error';
        status.textContent = 'Could not save. Please try again.';
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  function inputNumberOrNull(id) {
    var raw = byId(id).value.trim();
    if (raw === '') return null;
    var parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function setView(view, updateHash, focusHeading) {
    if (!VIEW_TITLES[view]) return;
    if (updateHash === undefined) updateHash = true;
    state.view = view;
    dom.viewTitle.textContent = VIEW_TITLES[view];

    document.querySelectorAll('[data-view]').forEach(function (button) {
      var active = button.getAttribute('data-view') === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    document.querySelectorAll('[data-view-panel]').forEach(function (panel) {
      var active = panel.getAttribute('data-view-panel') === view;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });

    if (updateHash) {
      var nextUrl = new URL(window.location.href);
      nextUrl.hash = view;
      history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
    }
    if (view === 'projects' && state.summary && projectFiltersActive() && !state.projectSummary) {
      scheduleProjectRefresh();
    }
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (focusHeading) dom.viewTitle.focus({ preventScroll: true });
  }

  function receiveSummary(summary) {
    if (!summary || typeof summary !== 'object') return;
    state.summary = summary;
    hydrateProjectModelOptions(summary);
    if (!projectFiltersActive()) {
      state.projectSummary = summary;
      state.projectSummaryKey = '';
      state.projectError = '';
    } else if (state.view === 'projects') {
      scheduleProjectRefresh();
    }
    updateGlobalChrome(summary);
    renderAlertStrip(summary.alerts);
    notifyAlerts(summary.alerts);
    renderCurrentView();
  }

  function updateGlobalChrome(summary) {
    var generatedAt = summary.generatedAt ? new Date(summary.generatedAt) : null;
    dom.lastUpdated.textContent = generatedAt && !Number.isNaN(generatedAt.getTime())
      ? generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : 'Just now';

    var activeCount = valueAt(summary, ['intelligence', 'active', 'sessionCount'], 0);
    dom.liveNavDot.classList.toggle('active', activeCount > 0);

    var insightCount = Array.isArray(summary.tips) ? summary.tips.length : 0;
    dom.insightNavCount.textContent = String(insightCount);
    dom.insightNavCount.classList.toggle('hidden', insightCount === 0);
  }

  function renderCurrentView() {
    if (!state.summary) return;
    if (state.view === 'overview') renderOverview();
    if (state.view === 'live') renderLive();
    if (state.view === 'projects') renderProjects();
    if (state.view === 'insights') renderInsights();
    if (state.view === 'settings') renderSettings();
  }

  function renderOverview() {
    var summary = state.summary;
    var today = summary.today || {};
    var allTime = summary.allTime || {};
    var config = summary.config || {};
    var intelligence = summary.intelligence || {};
    var active = intelligence.active || {};
    var velocity = intelligence.velocity || {};
    var cache = intelligence.cache || {};
    var tips = rankedTips(summary.tips || []);
    var projects = summary.byProject || [];

    byId('overviewSummary').textContent = overviewSentence(today, active, velocity, projects, tips);
    setCountUp('todayTokens', today.tokenTotal || 0, formatCompact);
    byId('todayTokens').title = formatNumber(today.tokenTotal || 0) + ' tokens';
    setCountUp('todayCost', today.costUsd || 0, formatCost);
    setCountUp('cacheReuse', cache.reuseRate || 0, formatPercent);
    setCountUp('activeSessions', active.sessionCount || 0, function (value) { return String(Math.round(value)); });

    setBudgetMetric(
      'todayTokensMeta',
      'tokenBudgetBar',
      today.tokenTotal || 0,
      config.dailyTokenCap,
      'tokens'
    );
    setBudgetMetric(
      'todayCostMeta',
      'costBudgetBar',
      today.costUsd || 0,
      config.dailyCostCapUsd,
      'cost'
    );

    byId('cacheReuseMeta').textContent = cache.estimatedSavingsUsd > 0
      ? formatCost(cache.estimatedSavingsUsd) + ' avoided through cache reads'
      : 'No measured cache savings yet';
    byId('cacheReuseBar').style.width = Math.min(100, Math.max(0, (cache.reuseRate || 0) * 100)) + '%';

    byId('activeSessionsMeta').textContent = active.sessionCount > 0
      ? shortProjectName(active.latestProject) + (active.latestBranch ? ' · ' + active.latestBranch : '')
      : 'No activity in the last ' + (active.windowMinutes || 10) + ' minutes';

    byId('allTimeCost').textContent = formatCost(allTime.costUsd || 0) + ' all time';
    renderSparkline('tokenSpark', summary.byDay || [], 'tokenTotal');
    renderSparkline('costSpark', summary.byDay || [], 'costUsd');
    renderPlan(summary.plan);
    renderEfficiency(summary.efficiency, summary.week);
    renderForecast(summary.forecast || {}, config);
    renderMonthBudget(summary.month, config);
    renderTokenMix(allTime);
    renderTopProjects(projects);
    renderTopInsights(tips);
    renderAttribution(summary.attribution);
    // Charts measure their stretched panels, so draw them after the cards
    // that share their rows.
    renderBurnChart(summary.byDay || []);
    renderHeatmap(summary.byHourOfWeek);
  }

  function renderAttribution(attribution) {
    var subagents = attribution && attribution.subagents;
    var types = subagents && Array.isArray(subagents.byType) ? subagents.byType : [];
    byId('subagentShare').textContent = subagents && subagents.runs > 0
      ? formatPercent(subagents.share) + ' of tokens · ' + subagents.runs + ' run' + (subagents.runs === 1 ? '' : 's')
      : 'No subagent runs';
    var subagentTokens = types.reduce(function (sum, type) { return sum + finiteOr0(type.tokenTotal); }, 0);
    byId('subagentTypes').innerHTML = types.length === 0
      ? '<div class="empty-state compact">No subagent usage in this scope. When Claude Code delegates to Task/Explore agents, their tokens and cost appear here.</div>'
      : types.slice(0, 5).map(function (type, index) {
        var share = subagentTokens > 0 ? finiteOr0(type.tokenTotal) / subagentTokens : 0;
        return '<div class="rank-row">' +
          '<span class="rank-number">' + (index + 1) + '</span>' +
          '<div class="rank-copy"><strong>' + escapeHtml(type.agentType || 'Unlabelled subagent') + '</strong><span>' + type.runs + ' run' + (type.runs === 1 ? '' : 's') + ' · ' + escapeHtml(formatNumber(type.messageCount)) + ' message' + (type.messageCount === 1 ? '' : 's') + ' · ' + escapeHtml(formatPercent(share)) + '</span>' + rankShare(share) + '</div>' +
          '<div class="rank-cost"><strong>' + escapeHtml(formatCost(type.costUsd || 0)) + '</strong><span>' + escapeHtml(formatCompact(type.tokenTotal || 0)) + ' tok</span></div>' +
        '</div>';
      }).join('');

    var tools = attribution && Array.isArray(attribution.tools) ? attribution.tools : [];
    var totals = (attribution && attribution.toolTotals) || {};
    byId('toolTotals').textContent = totals.calls > 0
      ? formatNumber(totals.calls) + ' calls · ' + formatNumber(totals.distinctTools) + ' tools'
      : 'No tool calls';
    var toolTokens = tools.reduce(function (sum, tool) { return sum + finiteOr0(tool.estimatedTokens); }, 0);
    byId('toolAttribution').innerHTML = tools.length === 0
      ? '<div class="empty-state compact">No tool calls in this scope.</div>'
      : tools.slice(0, 6).map(function (tool, index) {
        var label = tool.server ? tool.name.replace(/^mcp__.+?__/, '') : tool.name;
        var share = toolTokens > 0 ? finiteOr0(tool.estimatedTokens) / toolTokens : 0;
        return '<div class="rank-row">' +
          '<span class="rank-number">' + (index + 1) + '</span>' +
          '<div class="rank-copy"><strong title="' + escapeHtmlAttr(tool.name) + '">' + escapeHtml(label) + (tool.server ? '<span class="tool-badge">MCP · ' + escapeHtml(tool.server) + '</span>' : '') + '</strong><span>' + escapeHtml(formatNumber(tool.calls)) + ' call' + (tool.calls === 1 ? '' : 's') + ' · ' + escapeHtml(formatPercent(share)) + ' of result tokens</span>' + rankShare(share) + '</div>' +
          '<div class="rank-cost"><strong>≈' + escapeHtml(formatCompact(tool.estimatedTokens || 0)) + '</strong><span>result tok</span></div>' +
        '</div>';
      }).join('');

    var servers = attribution && Array.isArray(attribution.mcpServers) ? attribution.mcpServers : [];
    byId('mcpServers').textContent = (servers.length
      ? 'MCP servers: ' + servers.slice(0, 4).map(function (server) {
        return server.server + ' ≈' + formatCompact(server.estimatedTokens) + ' tok in ' + formatNumber(server.calls) + ' calls';
      }).join(' · ') + '. '
      : '') + 'Result tokens are estimated from result size (about ' + ((attribution && attribution.bytesPerTokenEstimate) || 4) + ' bytes per token) and count only what each call returned, not later re-reads from cache.';
  }

  function rankShare(ratio) {
    var pct = Math.min(100, Math.max(0, finiteOr0(ratio) * 100));
    return '<div class="rank-share" aria-hidden="true"><span style="width:' + pct.toFixed(1) + '%"></span></div>';
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Count a KPI up (or down) from its last shown value. The first render and
  // reduced-motion viewers get the final value immediately.
  function setCountUp(id, value, format) {
    var el = byId(id);
    var target = finiteOr0(value);
    var previous = state.countUps[id];
    if (previous && previous.frame) window.cancelAnimationFrame(previous.frame);
    var from = previous ? previous.current : null;
    var entry = { current: target, frame: 0 };
    state.countUps[id] = entry;
    if (from === null || from === target || prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function') {
      el.textContent = format(target);
      return;
    }
    var start = null;
    var duration = 700;
    entry.current = from;
    function step(now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      entry.current = t >= 1 ? target : from + (target - from) * eased;
      el.textContent = format(entry.current);
      entry.frame = t < 1 ? window.requestAnimationFrame(step) : 0;
    }
    entry.frame = window.requestAnimationFrame(step);
  }

  function overviewSentence(today, active, velocity, projects, tips) {
    var activeCopy = active.sessionCount > 0
      ? active.sessionCount + ' active session' + (active.sessionCount === 1 ? '' : 's')
      : 'no active sessions';
    var rateCopy = velocity.tokenTotal > 0
      ? formatCompact(velocity.tokensPerMinute || 0) + ' tokens/min recently'
      : 'no recent burn';
    return formatCompact(today.tokenTotal || 0) + ' tokens today across ' + projects.length +
      ' project' + (projects.length === 1 ? '' : 's') + ', with ' + activeCopy + ', ' + rateCopy +
      ', and ' + tips.length + ' actionable insight' + (tips.length === 1 ? '' : 's') + '.';
  }

  function setBudgetMetric(metaId, barId, used, cap, kind) {
    var meta = byId(metaId);
    var bar = byId(barId);
    if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) {
      meta.textContent = kind === 'tokens' ? 'No daily token cap set' : 'Local pricing estimate · no cost cap';
      bar.style.width = '0%';
      return;
    }
    var ratio = used / cap;
    var usedText = kind === 'tokens' ? formatCompact(used) : formatCost(used);
    var capText = kind === 'tokens' ? formatCompact(cap) : formatCost(cap);
    meta.textContent = usedText + ' of ' + capText + ' · ' + Math.round(ratio * 100) + '%';
    bar.style.width = Math.min(100, Math.max(0, ratio * 100)) + '%';
    bar.style.background = ratio >= 1 ? 'var(--grad-danger)' : ratio >= .8 ? 'var(--grad-warn)' : 'var(--grad-brand-h)';
  }

  function bindOverviewCharts() {
    var chart = byId('burnChart');
    chart.addEventListener('pointermove', function (event) {
      var hit = event.target && event.target.closest ? event.target.closest('[data-burn-index]') : null;
      if (hit) showBurnTooltip(Number(hit.getAttribute('data-burn-index')));
      else hideBurnTooltip();
    });
    chart.addEventListener('pointerleave', hideBurnTooltip);
    // Charts are drawn at the container's pixel width so labels keep their
    // real size; redraw them when the layout width changes.
    window.addEventListener('resize', function () {
      window.clearTimeout(state.overviewResizeTimer);
      state.overviewResizeTimer = window.setTimeout(function () {
        if (state.view !== 'overview' || !state.summary) return;
        renderBurnChart(state.summary.byDay || []);
        renderHeatmap(state.summary.byHourOfWeek);
      }, 150);
    });
  }

  function niceCeil(value) {
    if (!(value > 0)) return 1;
    var magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    var fraction = value / magnitude;
    // Each candidate splits into four round gridline steps.
    var steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) {
      if (fraction <= steps[i] + 1e-9) return steps[i] * magnitude;
    }
    return 10 * magnitude;
  }

  function roundedTopBar(x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h);
    var bottom = y + h;
    return 'M' + x.toFixed(1) + ',' + bottom.toFixed(1) +
      'V' + (y + radius).toFixed(1) +
      'Q' + x.toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + radius).toFixed(1) + ',' + y.toFixed(1) +
      'H' + (x + w - radius).toFixed(1) +
      'Q' + (x + w).toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + w).toFixed(1) + ',' + (y + radius).toFixed(1) +
      'V' + bottom.toFixed(1) + 'Z';
  }

  function smoothPath(points) {
    var d = 'M' + points[0][0].toFixed(1) + ',' + points[0][1].toFixed(1);
    for (var i = 1; i < points.length; i++) {
      var p0 = points[i - 1];
      var p1 = points[i];
      var mid = ((p0[0] + p1[0]) / 2).toFixed(1);
      d += 'C' + mid + ',' + p0[1].toFixed(1) + ' ' + mid + ',' + p1[1].toFixed(1) + ' ' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1);
    }
    return d;
  }

  function burnDayLabel(day) {
    var date = new Date(day.date + 'T12:00:00');
    return Number.isNaN(date.getTime()) ? String(day.date) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function renderBurnChart(byDay) {
    var chart = byId('burnChart');
    var days = (Array.isArray(byDay) ? byDay : []).slice(-14);
    chart.classList.remove('loading-block');
    chart.classList.remove('is-hovering');
    state.burnDays = days;
    if (days.length === 0) {
      chart.innerHTML = '<div class="empty-state compact">Usage history will appear after Claude Code records a session.</div>';
      byId('burnChartSummary').textContent = 'No usage history is available yet.';
      return;
    }

    // The SVG is absolutely positioned, so the box size comes from layout:
    // its width from the column and its height from the stretched panel.
    var width = Math.max(280, Math.round(chart.clientWidth || 720));
    var height = Math.max(220, Math.min(380, Math.round(chart.clientHeight || 252)));
    var left = 46;
    var right = 50;
    var top = 30;
    var bottom = 32;
    var plotW = width - left - right;
    var plotH = height - top - bottom;
    var baseY = top + plotH;
    var rawMaxTokens = Math.max.apply(null, days.map(function (d) { return finiteOr0(d.tokenTotal); }));
    var rawMaxCost = Math.max.apply(null, days.map(function (d) { return finiteOr0(d.costUsd); }));
    var maxTokens = niceCeil(rawMaxTokens);
    var maxCost = rawMaxCost > 0 ? niceCeil(rawMaxCost) : 1;
    var slot = plotW / days.length;
    var barWidth = Math.min(30, Math.max(8, slot * .56));
    var todayKey = localDateString(new Date());

    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var gy = top + (plotH / 4) * g;
      grid += '<line class="' + (g === 4 ? 'burn-baseline' : 'burn-grid') + '" x1="' + left + '" y1="' + gy.toFixed(1) + '" x2="' + (width - right) + '" y2="' + gy.toFixed(1) + '"></line>';
      grid += '<text class="burn-axis" text-anchor="end" x="' + (left - 10) + '" y="' + (gy + 4).toFixed(1) + '">' + escapeHtml(formatCompact(maxTokens * (1 - g / 4))) + '</text>';
      grid += '<text class="burn-axis cost" x="' + (width - right + 10) + '" y="' + (gy + 4).toFixed(1) + '">' + escapeHtml(formatCost(maxCost * (1 - g / 4))) + '</text>';
    }

    var bars = '';
    var hits = '';
    var labels = '';
    var points = [];
    var peakIndex = 0;
    var labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotW / 64))));
    days.forEach(function (day, index) {
      var center = left + slot * index + slot / 2;
      var tokens = finiteOr0(day.tokenTotal);
      if (tokens > finiteOr0(days[peakIndex].tokenTotal)) peakIndex = index;
      var barH = Math.max(3, (tokens / maxTokens) * plotH);
      var y = baseY - barH;
      var isToday = day.date === todayKey;
      bars += '<path class="burn-bar' + (isToday ? ' is-today' : '') + '" data-bar-index="' + index + '" d="' + roundedTopBar(center - barWidth / 2, y, barWidth, barH, 6) + '"></path>';
      var costY = baseY - (finiteOr0(day.costUsd) / maxCost) * plotH;
      points.push([center, costY]);
      hits += '<rect class="burn-hit" data-burn-index="' + index + '" data-x="' + center.toFixed(1) + '" data-y="' + Math.min(y, costY).toFixed(1) + '" x="' + (left + slot * index).toFixed(1) + '" y="' + top + '" width="' + slot.toFixed(1) + '" height="' + plotH + '"></rect>';
      if ((days.length - 1 - index) % labelEvery === 0) {
        labels += '<text class="burn-axis' + (isToday ? ' is-today' : '') + '" text-anchor="middle" x="' + center.toFixed(1) + '" y="' + (height - 8) + '">' + escapeHtml(isToday ? 'Today' : burnDayLabel(day)) + '</text>';
      }
    });

    var linePath = smoothPath(points);
    var areaPath = linePath + 'L' + points[points.length - 1][0].toFixed(1) + ',' + baseY + 'L' + points[0][0].toFixed(1) + ',' + baseY + 'Z';
    var dots = points.map(function (point, index) {
      var last = index === points.length - 1;
      return (last ? '<circle class="burn-halo" cx="' + point[0].toFixed(1) + '" cy="' + point[1].toFixed(1) + '" r="9"></circle>' : '') +
        '<circle class="burn-dot" data-dot-index="' + index + '" cx="' + point[0].toFixed(1) + '" cy="' + point[1].toFixed(1) + '" r="' + (last ? 4.5 : 3.2) + '"></circle>';
    }).join('');

    var peak = days[peakIndex];
    var peakText = formatCompact(peak.tokenTotal || 0);
    var peakCenter = left + slot * peakIndex + slot / 2;
    var peakTop = baseY - Math.max(3, (finiteOr0(peak.tokenTotal) / maxTokens) * plotH);
    var pillW = peakText.length * 7.4 + 18;
    var pillX = Math.min(width - right - pillW, Math.max(left, peakCenter - pillW / 2));
    var pillY = Math.max(2, Math.min(peakTop, points[peakIndex][1] - 6) - 28);
    var peakLabel = finiteOr0(peak.tokenTotal) > 0
      ? '<g class="burn-peak"><rect x="' + pillX.toFixed(1) + '" y="' + pillY.toFixed(1) + '" width="' + pillW.toFixed(1) + '" height="21" rx="10.5"></rect>' +
        '<text x="' + (pillX + pillW / 2).toFixed(1) + '" y="' + (pillY + 14.5).toFixed(1) + '" text-anchor="middle">' + escapeHtml(peakText) + '</text></g>'
      : '';

    chart.innerHTML =
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Fourteen day token and estimated cost chart">' +
        '<defs>' +
          '<linearGradient id="burnBarGradient" x1="0" y1="0" x2="0" y2="1"><stop class="burn-stop-a" offset="0"></stop><stop class="burn-stop-b" offset=".55"></stop><stop class="burn-stop-c" offset="1"></stop></linearGradient>' +
          '<linearGradient id="burnAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop class="burn-area-a" offset="0"></stop><stop class="burn-area-b" offset="1"></stop></linearGradient>' +
          '<filter id="burnGlow" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="4"></feGaussianBlur></filter>' +
        '</defs>' + grid +
        '<path class="burn-area" d="' + areaPath + '"></path>' +
        bars +
        '<path class="burn-line-glow" d="' + linePath + '"></path>' +
        '<path class="burn-line" d="' + linePath + '"></path>' + dots + peakLabel + labels + hits +
      '</svg>' +
      '<div class="burn-tooltip" role="presentation" hidden></div>';
    var totalTokens = days.reduce(function (sum, day) { return sum + finiteOr0(day.tokenTotal); }, 0);
    var totalCost = days.reduce(function (sum, day) { return sum + finiteOr0(day.costUsd); }, 0);
    byId('burnChartSummary').textContent = days.length + ' days shown: ' + formatNumber(totalTokens) +
      ' total tokens and ' + formatCost(totalCost) + ' estimated cost. Peak usage was ' +
      formatNumber(peak.tokenTotal || 0) + ' tokens on ' + peak.date + '.';
  }

  function showBurnTooltip(index) {
    var chart = byId('burnChart');
    var day = state.burnDays[index];
    var tooltip = chart.querySelector('.burn-tooltip');
    var svg = chart.querySelector('svg');
    var hit = chart.querySelector('[data-burn-index="' + index + '"]');
    if (!day || !tooltip || !svg || !hit) return;
    var viewWidth = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.width : 0;
    var svgWidth = svg.getBoundingClientRect().width;
    var scale = viewWidth > 0 ? svgWidth / viewWidth : 1;
    tooltip.innerHTML = '<strong>' + escapeHtml(burnDayLabel(day)) + '</strong>' +
      '<span><i class="tip-key bar"></i>' + escapeHtml(formatNumber(day.tokenTotal || 0)) + ' tokens</span>' +
      '<span><i class="tip-key line"></i>' + escapeHtml(formatCost(day.costUsd || 0)) + ' est. cost</span>';
    tooltip.hidden = false;
    var x = Number(hit.getAttribute('data-x')) * scale;
    var y = Number(hit.getAttribute('data-y')) * scale;
    var half = tooltip.offsetWidth / 2;
    tooltip.style.left = Math.min(svgWidth - half - 4, Math.max(half + 4, x)).toFixed(1) + 'px';
    tooltip.style.top = Math.max(tooltip.offsetHeight + 4, y - 10).toFixed(1) + 'px';
    chart.classList.add('is-hovering');
    chart.querySelectorAll('[data-bar-index],[data-dot-index]').forEach(function (node) {
      var nodeIndex = node.getAttribute('data-bar-index') || node.getAttribute('data-dot-index');
      node.classList.toggle('is-active', Number(nodeIndex) === index);
    });
  }

  function hideBurnTooltip() {
    var chart = byId('burnChart');
    var tooltip = chart.querySelector('.burn-tooltip');
    if (tooltip) tooltip.hidden = true;
    chart.classList.remove('is-hovering');
  }

  function renderSparkline(id, byDay, key) {
    var target = byId(id);
    var days = (Array.isArray(byDay) ? byDay : []).slice(-14);
    if (days.length < 2) {
      target.innerHTML = '';
      return;
    }
    var max = Math.max.apply(null, days.map(function (day) { return finiteOr0(day[key]); })) || 1;
    var points = days.map(function (day, index) {
      var x = (index / (days.length - 1)) * 100;
      var y = 28 - (finiteOr0(day[key]) / max) * 24;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var gradientId = id + 'Fill';
    target.innerHTML = '<defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="0" y2="1"><stop class="spark-stop-a" offset="0"></stop><stop class="spark-stop-b" offset="1"></stop></linearGradient></defs>' +
      '<polygon class="spark-area" fill="url(#' + gradientId + ')" points="0,30 ' + points.join(' ') + ' 100,30"></polygon>' +
      '<polyline points="' + points.join(' ') + '"></polyline>';
  }

  function renderHeatmap(grid) {
    var target = byId('usageHeatmap');
    var summaryEl = byId('heatmapSummary');
    target.classList.remove('loading-block');
    var tokens = grid && Array.isArray(grid.tokens) ? grid.tokens : [];
    var messages = grid && Array.isArray(grid.messages) ? grid.messages : [];
    if (!grid || !grid.recordCount || tokens.length !== 7) {
      target.innerHTML = '<div class="empty-state compact">Your weekday and hour rhythm appears once detailed message history is recorded.</div>';
      summaryEl.textContent = 'No detailed message history is available for the activity heatmap yet.';
      return;
    }

    // Monday-first rows read more naturally for a working week.
    var order = [1, 2, 3, 4, 5, 6, 0];
    // Measure the free box (its own height cleared), then size cells so the
    // grid fills the panel width and, when the row is stretched, its height.
    target.style.height = '';
    var available = Math.max(560, Math.round(target.clientWidth || 720));
    var availableHeight = Math.round(target.clientHeight || 0);
    var gap = 4;
    var left = 42;
    var top = 2;
    var axis = 26;
    var cell = Math.max(14, Math.min(34, Math.floor((available - left - gap * 23) / 24)));
    var cellH = Math.max(cell, Math.min(Math.round(cell * 1.5), Math.floor((availableHeight - top - axis - gap * 6) / 7)));
    var width = left + 24 * cell + 23 * gap;
    var height = top + 7 * cellH + 6 * gap + axis;
    var max = 0;
    var peak = { day: 0, hour: 0, tokens: 0 };
    var active = [];
    order.forEach(function (day) {
      for (var hour = 0; hour < 24; hour++) {
        var value = finiteOr0(tokens[day] && tokens[day][hour]);
        if (value > 0) active.push(value);
        if (value > max) max = value;
        if (value > peak.tokens) peak = { day: day, hour: hour, tokens: value };
      }
    });
    // Five steps: empty, then quartiles of the hours that had any usage, so a
    // few huge hours don't wash every other active hour into one colour.
    active.sort(function (a, b) { return a - b; });
    var quantile = function (q) { return active.length ? active[Math.floor(q * (active.length - 1))] : 0; };
    var q1 = quantile(.25);
    var q2 = quantile(.5);
    var q3 = quantile(.75);
    var level = function (value) {
      if (value <= 0) return 0;
      if (value >= max || value > q3) return 4;
      if (value > q2) return 3;
      if (value > q1) return 2;
      return 1;
    };
    var today = new Date().getDay();

    var cells = '';
    order.forEach(function (day, row) {
      var y = top + row * (cellH + gap);
      cells += '<text class="heat-axis' + (day === today ? ' is-today' : '') + '" text-anchor="end" x="' + (left - 10) + '" y="' + (y + cellH / 2 + 4).toFixed(1) + '">' + WEEKDAYS[day] + '</text>';
      for (var hour = 0; hour < 24; hour++) {
        var value = finiteOr0(tokens[day] && tokens[day][hour]);
        var count = finiteOr0(messages[day] && messages[day][hour]);
        cells += '<rect class="heat-cell l' + level(value) + '" x="' + (left + hour * (cell + gap)) + '" y="' + y + '" width="' + cell + '" height="' + cellH + '" rx="' + Math.min(6, Math.round(cell / 5)) + '">' +
          '<title>' + escapeHtml(WEEKDAYS[day] + ' ' + hourLabel(hour) + ' · ' + formatNumber(value) + ' tokens · ' + formatNumber(count) + ' messages') + '</title></rect>';
      }
    });
    var labels = '';
    var step = cell < 20 ? 6 : 3;
    for (var tick = 0; tick < 24; tick += step) {
      labels += '<text class="heat-axis" text-anchor="middle" x="' + (left + tick * (cell + gap) + cell / 2).toFixed(1) + '" y="' + (height - 6) + '">' + hourLabel(tick) + '</text>';
    }
    target.style.height = height + 'px';
    target.innerHTML = '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Tokens by weekday and hour of day">' + cells + labels + '</svg>';
    summaryEl.textContent = 'Busiest slot: ' + WEEKDAYS[peak.day] + ' ' + hourLabel(peak.hour) + '–' + hourLabel((peak.hour + 1) % 24) +
      ' with ' + formatNumber(peak.tokens) + ' tokens. Based on ' + formatNumber(grid.recordCount) +
      ' recent detailed messages in your local time zone.';
  }

  function renderEfficiency(efficiency, week) {
    var target = byId('efficiencyScore');
    var score = efficiency && typeof efficiency.score === 'number' ? efficiency.score : null;
    if (score === null) {
      target.innerHTML = '';
      byId('efficiencyComponents').innerHTML = '<div class="empty-state compact">The weekly score appears once there is usage in the last 7 days.</div>';
      byId('efficiencySuggestion').textContent = '';
    } else {
      var radius = 66;
      var circumference = 2 * Math.PI * radius;
      var clamped = Math.min(100, Math.max(0, score));
      var band = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';
      var bandLabel = band === 'good' ? 'Efficient' : band === 'warn' ? 'Room to improve' : 'Needs attention';
      target.innerHTML = '<svg viewBox="0 0 160 160" role="img" aria-label="' + escapeHtmlAttr('Weekly efficiency score ' + score + ' out of 100') + '">' +
        '<defs><linearGradient id="effRingGradient" x1="0" y1="0" x2="1" y2="1"><stop class="eff-stop-a ' + band + '" offset="0"></stop><stop class="eff-stop-b ' + band + '" offset="1"></stop></linearGradient></defs>' +
        '<circle class="eff-track" cx="80" cy="80" r="' + radius + '"></circle>' +
        '<circle class="eff-arc ' + band + '" cx="80" cy="80" r="' + radius + '" transform="rotate(-90 80 80)" stroke="url(#effRingGradient)" stroke-dasharray="' + circumference.toFixed(2) + '" stroke-dashoffset="' + (circumference * (1 - clamped / 100)).toFixed(2) + '"></circle>' +
        '<text class="eff-score-value" x="80" y="90" text-anchor="middle">' + score + '</text>' +
        '<text class="eff-score-caption" x="80" y="112" text-anchor="middle">OF 100</text>' +
      '</svg>' +
      '<span class="chip ' + (band === 'good' ? 'good' : band === 'warn' ? 'warn' : 'danger') + '"><i class="chip-dot"></i>' + bandLabel + '</span>';
      byId('efficiencyComponents').innerHTML = (efficiency.components || []).map(function (item) {
        var ratio = item.max > 0 ? item.points / item.max : 0;
        return '<div class="efficiency-row"><div><strong>' + escapeHtml(item.label) + '</strong><small>' + escapeHtml(item.detail) + '</small></div>' +
          '<div class="bar"><span class="' + (ratio >= .8 ? '' : ratio >= .5 ? 'mid' : 'low') + '" style="width:' + (Math.min(1, Math.max(0, ratio)) * 100).toFixed(1) + '%"></span></div>' +
          '<b>' + escapeHtml(String(item.points)) + '<small>/' + escapeHtml(String(item.max)) + ' pts</small></b></div>';
      }).join('');
      byId('efficiencySuggestion').textContent = efficiency.suggestion ? 'Biggest opportunity: ' + efficiency.suggestion : 'Nothing to improve this week. Nice work.';
    }

    if (!week) return;
    var current = week.current || {};
    var previous = week.previous || {};
    var change = previous.costUsd > 0 ? (current.costUsd - previous.costUsd) / previous.costUsd : null;
    byId('efficiencyWeek').textContent = formatCompact(current.tokenTotal || 0) + ' tokens and ' + formatCost(current.costUsd || 0) + ' this week' +
      (change === null ? '.' : ', ' + (change >= 0 ? 'up ' : 'down ') + formatPercent(Math.abs(change)) + ' on the previous week.') +
      ' The score uses cache reuse, open recommendations (dismissed ones included), and /compact use in long sessions.';
  }

  async function downloadWeeklyReport(withNames) {
    try {
      var response = await fetch('/api/report' + (withNames ? '?names=1' : ''), { cache: 'no-store' });
      if (!response.ok) throw new Error('Report request failed');
      var blob = await response.blob();
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'cc-token-meter-weekly-' + localDateString(new Date()) + (withNames ? '-with-names' : '') + '.md';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
      showToast(withNames ? 'Weekly report downloaded with project names.' : 'Weekly report downloaded. Project names are pseudonymized for sharing.');
    } catch (error) {
      showToast('Could not create the weekly report. Please try again.');
    }
  }

  function renderPlan(plan) {
    var panel = byId('planPanel');
    var subscribed = plan && plan.plan && plan.plan !== 'api';
    panel.classList.toggle('hidden', !subscribed);
    byId('costCardLabel').textContent = subscribed ? 'API-equivalent value today' : 'Estimated cost today';
    if (!subscribed) return;

    var block = plan.currentBlock;
    var badge = byId('planWindowBadge');
    var bar = byId('planWindowBar');
    var pace = byId('planWindowPace');
    var marker = byId('planWindowProjected');
    byId('planPanelKicker').textContent = (plan.planLabel + ' · ' + plan.blockHours + '-hour window').toUpperCase();

    if (!block) {
      setPlanTokens(0);
      byId('planWindowScale').textContent = plan.recordBlockTokens ? 'Record ' + formatCompact(plan.recordBlockTokens) : '—';
      pace.style.width = '0%';
      byId('planWindowReset').textContent = 'No active window. Your next message starts one.';
      byId('planWindowMeta').textContent = plan.recordBlockTokens
        ? 'Your largest recent window used ' + formatCompact(plan.recordBlockTokens) + ' tokens.'
        : 'Window progress appears after your first message.';
      bar.style.width = '0%';
      marker.classList.add('hidden');
      badge.textContent = 'Idle';
      badge.className = 'soft-badge';
    } else {
      var ratio = typeof block.ratio === 'number' ? block.ratio : null;
      var projected = typeof block.projectedRatio === 'number' ? block.projectedRatio : null;
      setPlanTokens(block.tokenTotal);
      byId('planWindowScale').textContent = block.referenceKind === 'limit'
        ? formatCompact(block.reference) + ' limit'
        : block.referenceKind === 'record' ? formatCompact(block.reference) + ' record' : '—';
      pace.style.width = (projected == null ? 0 : Math.min(100, projected * 100)).toFixed(1) + '%';
      byId('planWindowReset').textContent = 'Resets in ' + formatMinutes(block.remainingMinutes) + ' · at ' + formatTime(block.end);
      bar.style.width = (ratio == null ? 0 : Math.min(100, ratio * 100)) + '%';
      bar.style.background = ratio == null ? 'var(--grad-good)' : ratio >= 1 ? 'var(--grad-danger)' : ratio >= .8 ? 'var(--grad-warn)' : 'var(--grad-good)';
      marker.classList.toggle('hidden', projected == null);
      if (projected != null) marker.style.left = 'calc(' + Math.min(100, projected * 100).toFixed(1) + '% - 1.5px)';

      var referenceCopy = block.referenceKind === 'limit'
        ? formatPercent(ratio) + ' of your ' + formatCompact(block.reference) + '-token window limit'
        : block.referenceKind === 'record'
          ? formatPercent(ratio) + ' of your largest recent window (' + formatCompact(block.reference) + ')'
          : 'Your first tracked window';
      byId('planWindowMeta').textContent = referenceCopy + ' · ' + formatCompact(block.tokensPerMinute) +
        ' tok/min · on pace for ' + formatCompact(block.projectedTokens) + ' by reset.';
      var over = ratio != null && ratio >= 1;
      var near = projected != null && projected >= 1;
      badge.textContent = over ? 'Over limit' : near ? 'On pace to exceed' : 'Active';
      badge.className = 'soft-badge ' + (over || near ? 'warn' : 'good');
    }

    var recent = Array.isArray(plan.recentBlocks) ? plan.recentBlocks : [];
    var maxBlock = Math.max.apply(null, recent.map(function (item) { return finiteOr0(item.tokenTotal); }).concat([1]));
    byId('planHistoryPeak').textContent = recent.length
      ? recent.length + ' window' + (recent.length === 1 ? '' : 's') + ' · peak ' + formatCompact(maxBlock) + ' tok'
      : 'No windows yet';
    byId('planRecentBlocks').innerHTML = recent.map(function (item) {
      var height = Math.max(5, (finiteOr0(item.tokenTotal) / maxBlock) * 100);
      return '<span class="' + (item.active ? 'active' : '') + '" style="height:' + height.toFixed(1) + '%" title="' +
        escapeHtmlAttr(formatDateTime(item.start) + ' · ' + formatNumber(item.tokenTotal) + ' tokens · ' + formatCost(item.costUsd)) + '"></span>';
    }).join('');

    var value = plan.apiValue || {};
    byId('planValue').textContent = formatCost(value.monthToDateUsd || 0);
    byId('planValueMeta').textContent = typeof value.multipleOfPlan === 'number'
      ? (value.multipleOfPlan >= 1 ? trimNumber(value.multipleOfPlan, 1) + '×' : formatPercent(value.multipleOfPlan) + ' of') +
        ' your ' + formatCost(value.planMonthlyUsd) + '/month ' + plan.planLabel + ' plan, at local API prices.'
      : 'Set your plan price in Settings to compare.';

    var weekly = plan.weekly || {};
    byId('planWeekly').textContent = formatCompact(weekly.tokenTotal || 0) + ' tok';
    byId('planWeeklyMeta').textContent = typeof weekly.ratio === 'number'
      ? formatPercent(weekly.ratio) + ' of your ' + formatCompact(weekly.limit) + '-token weekly limit.'
      : formatCost(weekly.costUsd || 0) + ' API-equivalent. Set a weekly limit in Settings to track pace.';
  }

  function setPlanTokens(tokens) {
    byId('planWindowTokens').innerHTML = escapeHtml(formatCompact(tokens)) + '<span class="plan-unit">tok</span>';
  }

  function formatMinutes(minutes) {
    var total = Math.max(0, Math.round(finiteOr0(minutes)));
    var hours = Math.floor(total / 60);
    return hours ? hours + 'h ' + (total % 60) + 'm' : total + 'm';
  }

  function formatDateTime(timestamp) {
    var date = new Date(timestamp);
    return Number.isNaN(date.getTime())
      ? 'Unknown time'
      : date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function hourLabel(hour) {
    return String(hour).padStart(2, '0') + ':00';
  }

  function contextWindowFor(model, observedMax) {
    // Claude Code marks extended-context sessions with a [1m] model suffix;
    // a prompt larger than the standard window also proves the larger one.
    if (/\[1m\]/i.test(String(model || '')) || observedMax > DEFAULT_CONTEXT_WINDOW) return EXTENDED_CONTEXT_WINDOW;
    return DEFAULT_CONTEXT_WINDOW;
  }

  function renderContextGauge(session) {
    var usage = session.timeline && Array.isArray(session.timeline.usage) ? session.timeline.usage : [];
    if (usage.length === 0) return '';
    var promptSize = function (point) {
      return finiteOr0(point.inputTokens) + finiteOr0(point.cacheCreationInputTokens) + finiteOr0(point.cacheReadInputTokens);
    };
    var last = usage[usage.length - 1];
    var current = promptSize(last);
    var observedMax = usage.reduce(function (max, point) { return Math.max(max, promptSize(point)); }, 0);
    var windowSize = contextWindowFor(last.model, observedMax);
    var ratio = Math.min(1, current / windowSize);
    var radius = 50;
    var circumference = 2 * Math.PI * radius;
    var level = ratio >= .8 ? 'danger' : ratio >= .6 ? 'warn' : 'ok';
    var advice = ratio >= .8
      ? 'Close to the limit. Run /compact or start a focused session before quality drops.'
      : ratio >= .6
        ? 'Context is filling up. Plan a /compact at the next natural break.'
        : 'Plenty of room in the current context.';
    var dash = ratio > 0 ? Math.max(.012, ratio) : 0;
    return '<div class="context-gauge ' + level + '">' +
      '<div class="ctx-ring">' +
        '<svg viewBox="0 0 120 120" role="img" aria-label="' + escapeHtmlAttr(formatPercent(ratio) + ' of the estimated context window used') + '">' +
          '<defs><linearGradient id="ctxRingGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="ctx-stop-a"></stop><stop offset="1" class="ctx-stop-b"></stop></linearGradient></defs>' +
          '<circle class="ctx-ring-track" cx="60" cy="60" r="' + radius + '"></circle>' +
          '<circle class="ctx-ring-fill" cx="60" cy="60" r="' + radius + '" stroke-dasharray="' + circumference.toFixed(2) + '" stroke-dashoffset="' + (circumference * (1 - dash)).toFixed(2) + '"></circle>' +
        '</svg>' +
        '<div class="ctx-ring-value" aria-hidden="true"><strong>' + escapeHtml(Math.round(ratio * 100)) + '<span>%</span></strong><small>used</small></div>' +
      '</div>' +
      '<div class="ctx-copy"><span>Latest message</span><strong>' + escapeHtml(formatCompact(current)) + ' <em>of ' + escapeHtml(formatCompact(windowSize)) + '</em></strong>' +
      '<p>' + escapeHtml(advice) + '</p></div>' +
      '<small class="ctx-note">Window size is estimated from the model and observed prompts.</small>' +
    '</div>';
  }

  function estimateBadge(flag) {
    return flag === true
      ? '<abbr class="est-badge" title="Includes a model without a local pricing row, so this cost uses fallback pricing.">≈ est.</abbr>'
      : '';
  }

  function renderMonthBudget(month, config) {
    var bar = byId('monthBar');
    var marker = byId('monthProjected');
    if (!month || !month.month) {
      byId('monthSpend').textContent = '—';
      byId('monthMeta').textContent = 'Monthly usage appears after the first session this month.';
      bar.style.width = '0%';
      marker.classList.add('hidden');
      return;
    }
    var date = new Date(month.month + '-01T12:00:00');
    byId('monthLabel').textContent = Number.isNaN(date.getTime()) ? 'This month' : date.toLocaleDateString([], { month: 'long' }) + ' so far';
    var costCap = typeof config.monthlyCostCapUsd === 'number' && config.monthlyCostCapUsd > 0 ? config.monthlyCostCapUsd : null;
    var tokenCap = !costCap && typeof config.monthlyTokenCap === 'number' && config.monthlyTokenCap > 0 ? config.monthlyTokenCap : null;
    var used = costCap ? month.costUsd : tokenCap ? month.tokenTotal : null;
    var projected = costCap ? month.projectedCostUsd : tokenCap ? month.projectedTokens : null;
    var cap = costCap || tokenCap;
    var fmt = costCap ? formatCost : formatCompact;

    if (!cap) {
      byId('monthSpend').textContent = formatCost(month.costUsd || 0) + ' · ' + formatCompact(month.tokenTotal || 0) + ' tok';
      byId('monthMeta').textContent = 'On pace for ' + formatCost(month.projectedCostUsd || 0) + ' by month end. Set a monthly budget in Settings to track it.';
      bar.style.width = '0%';
      marker.classList.add('hidden');
      return;
    }
    var ratio = used / cap;
    var projectedRatio = projected / cap;
    byId('monthSpend').textContent = fmt(used) + ' of ' + fmt(cap) + (tokenCap ? ' tok' : '') + ' · ' + formatPercent(ratio);
    bar.style.width = Math.min(100, ratio * 100) + '%';
    bar.style.background = ratio >= 1 ? 'var(--grad-danger)' : (ratio * 100 >= (config.warnThresholdPct || 80) || projectedRatio >= 1) ? 'var(--grad-warn)' : 'var(--grad-good)';
    marker.classList.toggle('hidden', !(projectedRatio > 0));
    marker.style.left = 'calc(' + Math.min(100, projectedRatio * 100).toFixed(1) + '% - 1px)';
    byId('monthMeta').textContent = 'On pace for ' + fmt(projected) + (tokenCap ? ' tok' : '') + ' by month end (' + formatPercent(projectedRatio) + ' of budget).';
    // The forecast badge otherwise reflects only the daily cap; a monthly
    // budget on pace to be passed must not read as "On track".
    if (projectedRatio >= 1) {
      byId('forecastBadge').textContent = 'Over pace';
      byId('forecastBadge').className = 'soft-badge warn';
      byId('forecastMessage').className = 'forecast-message warn';
      byId('forecastMessage').textContent = 'At this month\'s rate you will pass your ' + fmt(cap) + (tokenCap ? '-token' : '') + ' monthly budget before month end.';
    }
  }

  function renderForecast(forecast, config) {
    var badge = byId('forecastBadge');
    var message = byId('forecastMessage');
    if (!forecast.daysObserved) {
      byId('projectedCost').textContent = '—';
      byId('averageDailyCost').textContent = '—';
      byId('projectedTokens').textContent = '—';
      byId('forecastBasis').textContent = 'Waiting for enough usage history';
      badge.textContent = 'Learning';
      badge.className = 'soft-badge';
      message.className = 'forecast-message neutral';
      message.textContent = 'A forecast appears after the first day of local usage.';
      return;
    }

    byId('projectedCost').textContent = formatCost(forecast.projectedCostUsd || 0);
    byId('averageDailyCost').textContent = formatCost(forecast.avgDailyCostUsd || 0) + '/day';
    byId('projectedTokens').textContent = formatCompact(forecast.projectedTokens || 0);
    byId('forecastBasis').textContent = 'Based on the last ' + forecast.daysObserved + ' observed day' + (forecast.daysObserved === 1 ? '' : 's');

    if (forecast.exceedsDailyCap === true) {
      badge.textContent = 'Over pace';
      badge.className = 'soft-badge warn';
      message.className = 'forecast-message warn';
      message.textContent = 'Your recent daily average is above the ' + formatCost(config.dailyCostCapUsd || 0) + ' cost cap.';
    } else {
      badge.textContent = 'On track';
      badge.className = 'soft-badge good';
      message.className = 'forecast-message good';
      message.textContent = config.dailyCostCapUsd
        ? 'Your recent average remains within the configured daily cost cap.'
        : 'Set a daily cost cap in Settings to add pace warnings.';
    }
  }

  function renderTokenMix(allTime) {
    var entries = [
      { key: 'inputTokens', label: 'Fresh input', cls: 'input', hint: 'Uncached prompt tokens' },
      { key: 'outputTokens', label: 'Output', cls: 'output', hint: 'Model responses' },
      { key: 'cacheCreationInputTokens', label: 'Cache writes', cls: 'write', hint: 'Prompt prefixes saved to cache' },
      { key: 'cacheReadInputTokens', label: 'Cache reads', cls: 'read', hint: 'Prompt prefixes reused from cache' }
    ];
    var total = entries.reduce(function (sum, entry) { return sum + (allTime[entry.key] || 0); }, 0);
    if (total <= 0) {
      byId('tokenMix').innerHTML = '<div class="empty-state compact">Token composition appears after usage is recorded.</div>';
      return;
    }

    var segments = entries.map(function (entry) {
      var pct = ((allTime[entry.key] || 0) / total) * 100;
      return '<span class="mix-segment mix-' + entry.cls + '" style="width:' + pct.toFixed(3) + '%" title="' + escapeHtmlAttr(entry.label + ': ' + formatPercent(pct / 100)) + '"></span>';
    }).join('');
    var legend = entries.map(function (entry) {
      var value = allTime[entry.key] || 0;
      return '<div class="mix-item"><i class="mix-swatch mix-' + entry.cls + '"></i>' +
        '<div class="mix-label"><strong>' + escapeHtml(entry.label) + '</strong><small>' + escapeHtml(entry.hint) + '</small></div>' +
        '<div class="mix-figure"><strong>' + escapeHtml(formatCompact(value)) + '</strong><small>' + escapeHtml(formatPercent(value / total)) + '</small></div></div>';
    }).join('');
    var readShare = (allTime.cacheReadInputTokens || 0) / total;
    byId('tokenMix').innerHTML = '<div class="mix-total"><strong>' + escapeHtml(formatCompact(total)) + '</strong><span>tokens processed, all time</span></div>' +
      '<div class="mix-bar">' + segments + '</div><div class="mix-legend">' + legend + '</div>' +
      (readShare > 0 ? '<p class="mix-note">' + escapeHtml(formatPercent(readShare) + ' of all tokens were cache reads, billed at a tenth of the input rate.') + '</p>' : '');
  }

  function renderTopProjects(projects) {
    var top = (Array.isArray(projects) ? projects : []).slice().sort(function (a, b) {
      return (b.costUsd || 0) - (a.costUsd || 0);
    }).slice(0, 4);
    if (top.length === 0) {
      byId('topProjects').innerHTML = '<div class="empty-state compact">No projects found yet.</div>';
      return;
    }
    var totalCost = (Array.isArray(projects) ? projects : []).reduce(function (sum, project) { return sum + finiteOr0(project.costUsd); }, 0);
    byId('topProjects').innerHTML = top.map(function (project, index) {
      var share = totalCost > 0 ? finiteOr0(project.costUsd) / totalCost : 0;
      return '<div class="rank-row">' +
        '<span class="rank-number">' + (index + 1) + '</span>' +
        '<div class="rank-copy"><strong title="' + escapeHtmlAttr(project.project) + '">' + escapeHtml(shortProjectName(project.project)) + '</strong><span>' + project.sessions.length + ' session' + (project.sessions.length === 1 ? '' : 's') + ' · ' + escapeHtml(formatPercent(share)) + ' of cost</span>' + rankShare(share) + '</div>' +
        '<div class="rank-cost"><strong>' + escapeHtml(formatCost(project.costUsd || 0)) + estimateBadge(project.estimatedCostUsed) + '</strong><span>' + escapeHtml(formatCompact(project.tokenTotal || 0)) + ' tok</span></div>' +
      '</div>';
    }).join('');
  }

  function renderTopInsights(tips) {
    var top = tips.slice(0, 3);
    if (top.length === 0) {
      byId('topInsights').innerHTML = '<div class="empty-state compact">No current recommendations. Your measured sessions look healthy.</div>';
      return;
    }
    byId('topInsights').innerHTML = top.map(function (tip) {
      var kind = tipKind(tip);
      return '<div class="action-item' + (tip.severity === 'warn' ? ' warn' : '') + '">' +
        '<span class="action-icon ' + (tip.severity === 'warn' ? 'warn' : '') + '" aria-hidden="true">' + escapeHtml(kind.icon) + '</span>' +
        '<div class="action-copy"><strong>' + escapeHtml(kind.label) + '</strong><p>' + escapeHtml(tip.message || '') + '</p>' +
        (savingText(tip) ? '<span class="action-saving">' + escapeHtml(savingText(tip)) + '</span>' : '') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderLive() {
    var summary = state.summary;
    var sessions = Array.isArray(summary.sessions) ? summary.sessions.slice() : [];
    sessions.sort(function (a, b) { return timestampOf(b.lastTimestamp) - timestampOf(a.lastTimestamp); });
    if (sessions.length === 0) {
      byId('liveSessionContent').innerHTML = '<div class="empty-state-card"><div class="empty-icon">⌁</div><h2>No sessions yet</h2><p>Start using Claude Code and this view will show live burn velocity, message-level usage, model changes, and tool-event markers.</p></div>';
      return;
    }

    var activeLatestId = valueAt(summary, ['intelligence', 'active', 'latestSessionId'], null);
    if (!state.selectedSessionId || !sessions.some(function (s) { return s.sessionId === state.selectedSessionId; })) {
      state.selectedSessionId = activeLatestId || sessions[0].sessionId;
    }
    var session = sessions.find(function (item) { return item.sessionId === state.selectedSessionId; }) || sessions[0];
    var now = timestampOf(summary.generatedAt);
    var activeWindow = valueAt(summary, ['intelligence', 'active', 'windowMinutes'], 10) * 60_000;
    var isActive = Number.isFinite(now) && now - timestampOf(session.lastTimestamp) <= activeWindow;
    var models = Array.isArray(session.models) ? session.models : [];
    var currentModel = models.length ? models[models.length - 1] : 'Unknown model';
    var velocity = valueAt(summary, ['intelligence', 'velocity'], {});

    var options = sessions.map(function (item) {
      var label = shortProjectName(item.project) + ' · ' + String(item.sessionId || '').slice(0, 8);
      return '<option value="' + escapeHtmlAttr(item.sessionId) + '"' + (item.sessionId === session.sessionId ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join('');

    var tokens = finiteOr0(session.tokenTotal);
    var cost = finiteOr0(session.costUsd);
    var messages = finiteOr0(session.messageCount);
    var shortName = shortProjectName(session.project);
    var slash = shortName.lastIndexOf('/');
    var projectHtml = slash > 0
      ? '<span class="live-project-parent">' + escapeHtml(shortName.slice(0, slash + 1)) + '</span>' + escapeHtml(shortName.slice(slash + 1))
      : escapeHtml(shortName);
    var gauge = renderContextGauge(session);

    byId('liveSessionContent').innerHTML =
      '<article class="live-hero">' +
        '<div class="live-hero-head">' +
          '<div class="live-identity"><span class="live-status ' + (isActive ? '' : 'inactive') + '"><i></i>' + (isActive ? 'Active now' : 'Recent session') + '</span>' +
          '<h2 title="' + escapeHtmlAttr(session.project || 'unknown') + '">' + projectHtml + '</h2>' +
          '<p class="live-tags">' +
            '<span class="live-tag"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.6" /><circle cx="4.5" cy="12.5" r="1.6" /><circle cx="11.5" cy="5.5" r="1.6" /><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2.2 2.8-5.6 4" /></svg>' + escapeHtml(session.gitBranch || '(no branch)') + '</span>' +
            '<span class="live-tag"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5L8 1.8Z" /><path d="M2.8 5.2 8 8.3l5.2-3.1M8 8.3v5.6" /></svg>' + escapeHtml(currentModel) + '</span>' +
            '<span class="live-tag quiet">updated ' + escapeHtml(formatRelative(session.lastTimestamp, summary.generatedAt)) + '</span>' +
          '</p></div>' +
          '<div class="live-picker"><span class="live-picker-label" aria-hidden="true">Viewing session</span>' +
          '<label><span class="sr-only">Select session</span><select id="sessionPicker" class="session-picker">' + options + '</select></label></div>' +
        '</div>' +
        '<div class="live-metrics">' +
          liveMetric('Total tokens', formatCompact(tokens), formatNumber(tokens) + ' exact', 'featured') +
          liveMetric('Estimated cost', (session.estimatedCostUsed ? '≈ ' : '') + formatCost(cost), messages > 0 ? formatCost(cost / messages) + ' per message' : 'No priced messages yet') +
          liveMetric('Messages', formatNumber(messages), messages > 0 ? formatCompact(tokens / messages) + ' tokens on average' : 'Waiting for the first reply') +
          liveMetric('Session span', formatDuration(session.firstTimestamp, session.lastTimestamp), 'Started ' + formatDay(session.firstTimestamp)) +
        '</div>' +
      '</article>' +
      '<div class="live-grid">' +
        '<article class="panel live-timeline-panel"><div class="panel-header"><div><p class="panel-kicker">MESSAGE TIMELINE</p><h3>Token burn and tool activity</h3></div>' +
          '<div class="chart-legend live-legend" aria-hidden="true"><span><i class="legend-bar"></i>Per message</span><span><i class="legend-line"></i>Cumulative</span><span><i class="legend-tool"></i>Tool call</span></div></div>' +
        '<div class="session-chart">' + renderSessionTimeline(session.timeline) + '</div></article>' +
        '<div class="live-side">' +
          '<article class="panel context-panel"><div class="panel-header"><div><p class="panel-kicker">CONTEXT WINDOW</p><h3>Latest prompt size</h3></div></div>' +
          (gauge || '<div class="empty-state compact">Context use appears once this session has message-level usage.</div>') + '</article>' +
          '<article class="velocity-card"><div class="velocity-head"><span>Workspace velocity · last ' + escapeHtml(velocity.windowMinutes || 15) + ' min</span><i aria-hidden="true"></i></div>' +
          '<strong><b>' + escapeHtml(formatCompact(velocity.tokensPerMinute || 0)) + '</b> tokens/min</strong>' +
          '<small>' + escapeHtml(formatCost(velocity.costPerHour || 0)) + '/hour if this short-term pace continues</small></article>' +
        '</div>' +
      '</div>' +
      '<article class="panel session-detail-panel"><div class="panel-header"><div><p class="panel-kicker">SESSION DETAILS</p><h3>Current context</h3></div><span class="panel-total">' + escapeHtml(formatNumber(messages)) + ' messages</span></div>' +
        '<dl class="session-detail-list">' +
          detailRow('Session ID', '<code>' + escapeHtml(session.sessionId) + '</code>') +
          detailRow('Project', '<code>' + escapeHtml(session.project || 'unknown') + '</code>') +
          detailRow('Branch', '<code>' + escapeHtml(session.gitBranch || '(no branch)') + '</code>') +
          detailRow('Model' + (models.length > 1 ? 's' : ''), escapeHtml(models.join(', ') || 'Unknown')) +
          detailRow('Claude Code version', escapeHtml(session.version || 'Not recorded')) +
          detailRow('Pricing quality', session.estimatedCostUsed ? '<span class="detail-flag warn">Fallback estimate used</span>' : '<span class="detail-flag good">Recognized local pricing rows</span>') +
          detailRow('Subagents', subagentSummary(session)) +
        '</dl>' +
      '</article>';

    // Redraw the timeline at the panel's real width so axis text stays at
    // its intended pixel size instead of shrinking with the viewBox.
    var chartHost = document.querySelector('#liveSessionContent .session-chart');
    if (chartHost && chartHost.clientWidth > 0) {
      var chartNote = chartHost.querySelector('.chart-summary');
      var chartHeight = chartHost.clientHeight - (chartNote ? chartNote.offsetHeight + 14 : 0);
      chartHost.innerHTML = renderSessionTimeline(session.timeline, chartHost.clientWidth, chartHeight);
    }

    byId('sessionPicker').addEventListener('change', function (event) {
      state.selectedSessionId = event.target.value;
      renderLive();
    });
  }

  function subagentSummary(session) {
    var agents = Array.isArray(session.subagents) ? session.subagents : [];
    if (agents.length === 0) return 'None in this session';
    var types = {};
    agents.forEach(function (agent) {
      var label = agent.agentType || 'unlabelled';
      types[label] = (types[label] || 0) + 1;
    });
    var typeCopy = Object.keys(types).map(function (label) { return types[label] + '× ' + label; }).join(', ');
    return escapeHtml(agents.length + ' run' + (agents.length === 1 ? '' : 's') + ' (' + typeCopy + ') · ' +
      formatCompact(session.subagentTokenTotal || 0) + ' tokens · ' + formatCost(session.subagentCostUsd || 0) + ' on top of this session');
  }

  function liveMetric(label, value, note, modifier) {
    return '<div class="live-metric' + (modifier ? ' ' + modifier : '') + '"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong>' +
      (note ? '<small>' + escapeHtml(note) + '</small>' : '') + '</div>';
  }

  function detailRow(label, htmlValue) {
    return '<div><dt>' + escapeHtml(label) + '</dt><dd>' + htmlValue + '</dd></div>';
  }

  function renderSessionTimeline(timeline, measuredWidth, measuredHeight) {
    var usage = timeline && Array.isArray(timeline.usage) ? timeline.usage : [];
    var tools = timeline && Array.isArray(timeline.tools) ? timeline.tools : [];
    if (usage.length === 0) return '<div class="empty-state compact">No message-level timeline is available for this session.</div>';

    // The viewBox matches the rendered width, so 1 unit = 1 CSS pixel and
    // axis labels keep their real 11-12px size at every breakpoint.
    var width = Math.round(Math.min(1600, Math.max(300, measuredWidth || 720)));
    var height = Math.round(Math.min(520, Math.max(276, measuredHeight || 276)));
    var padL = 50;
    var padR = 54;
    var padTop = 14;
    var plotBottom = height - 62;
    var plotW = width - padL - padR;
    var plotH = plotBottom - padTop;
    var laneY = plotBottom + 14;
    var laneH = 16;
    var maxPoint = Math.max.apply(null, usage.map(function (p) { return p.tokenTotal || 0; })) || 1;
    var cumulative = [];
    var running = 0;
    usage.forEach(function (point) { running += point.tokenTotal || 0;cumulative.push(running); });
    var maxCumulative = running || 1;
    var slot = plotW / usage.length;
    var barWidth = Math.max(1.5, Math.min(18, slot * .62));
    var barRadius = Math.min(4, barWidth / 2);
    var bars = '';
    var points = [];
    var xs = [];

    usage.forEach(function (point, index) {
      var x = padL + slot * index + slot / 2;
      var barH = Math.max(2, ((point.tokenTotal || 0) / maxPoint) * plotH);
      var y = plotBottom - barH;
      bars += '<rect class="session-bar' + (index === usage.length - 1 ? ' latest' : '') + '" x="' + (x - barWidth / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + barH.toFixed(1) + '" rx="' + barRadius.toFixed(1) + '"><title>' + escapeHtml(formatTime(point.timestamp) + ' · ' + formatNumber(point.tokenTotal || 0) + ' tokens · ' + formatCost(point.costUsd || 0)) + '</title></rect>';
      var lineY = plotBottom - (cumulative[index] / maxCumulative) * plotH;
      xs.push(x);
      points.push(x.toFixed(1) + ',' + lineY.toFixed(1));
    });

    var grid = [0, .25, .5, .75, 1].map(function (fraction) {
      var y = (plotBottom - fraction * plotH).toFixed(1);
      return '<line class="chart-grid-line' + (fraction === 0 ? ' base' : ' dashed') + '" x1="' + padL + '" y1="' + y + '" x2="' + (width - padR) + '" y2="' + y + '"></line>' +
        '<text class="chart-label" text-anchor="end" x="' + (padL - 10) + '" y="' + (Number(y) + 4) + '">' + escapeHtml(formatCompact(maxPoint * fraction)) + '</text>' +
        '<text class="chart-label cumulative" x="' + (width - padR + 10) + '" y="' + (Number(y) + 4) + '">' + escapeHtml(formatCompact(maxCumulative * fraction)) + '</text>';
    }).join('');

    var lastX = xs[xs.length - 1];
    var lastY = plotBottom - plotH;
    var area = 'M' + xs[0].toFixed(1) + ',' + plotBottom + ' L' + points.join(' L') + ' L' + lastX.toFixed(1) + ',' + plotBottom + ' Z';

    var firstTs = timestampOf(usage[0].timestamp);
    var lastTs = timestampOf(usage[usage.length - 1].timestamp);
    var span = Math.max(1, lastTs - firstTs);
    var ticks = tools.map(function (tool) {
      var ratio = Number.isFinite(timestampOf(tool.timestamp)) ? (timestampOf(tool.timestamp) - firstTs) / span : 0;
      var x = padL + Math.min(1, Math.max(0, ratio)) * plotW;
      return '<rect class="tool-tick" x="' + (x - 1.5).toFixed(1) + '" y="' + (laneY + 3) + '" width="3" height="' + (laneH - 6) + '" rx="1.5"><title>' + escapeHtml((tool.name || 'tool') + ' · ' + formatTime(tool.timestamp)) + '</title></rect>';
    }).join('');

    var timeY = height - 10;
    var mid = Math.floor(usage.length / 2);
    var midLabel = usage.length > 2 && plotW > 360
      ? '<text class="chart-label" text-anchor="middle" x="' + xs[mid].toFixed(1) + '" y="' + timeY + '">' + escapeHtml(formatTime(usage[mid].timestamp)) + '</text>'
      : '';

    var summary = usage.length + ' messages shown, ' + formatNumber(running) + ' cumulative tokens, and ' + tools.length + ' tool event' + (tools.length === 1 ? '' : 's') + '.';
    return '<p class="chart-summary">' + escapeHtml(summary) + '</p><svg class="session-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Per-message tokens with cumulative burn and tool markers">' +
      '<defs>' +
        '<linearGradient id="liveBarGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="tl-stop-bar-a"></stop><stop offset="1" class="tl-stop-bar-b"></stop></linearGradient>' +
        '<linearGradient id="liveAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="tl-stop-area"></stop><stop offset="1" class="tl-stop-area-end"></stop></linearGradient>' +
      '</defs>' +
      grid + bars +
      '<path class="session-area" d="' + area + '"></path>' +
      '<polyline class="session-line" points="' + points.join(' ') + '"></polyline>' +
      '<circle class="session-dot-halo" cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="8"></circle>' +
      '<circle class="session-dot" cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="4"></circle>' +
      '<rect class="tool-lane" x="' + padL + '" y="' + laneY + '" width="' + plotW.toFixed(1) + '" height="' + laneH + '" rx="' + (laneH / 2) + '"></rect>' +
      '<text class="chart-label" text-anchor="end" x="' + (padL - 10) + '" y="' + (laneY + laneH - 4) + '">Tools</text>' +
      (tools.length ? ticks : '<text class="chart-label lane-empty" x="' + (padL + 12) + '" y="' + (laneY + laneH - 4) + '">No tool calls recorded for this session</text>') +
      '<text class="chart-label" x="' + padL + '" y="' + timeY + '">' + escapeHtml(formatTime(usage[0].timestamp)) + '</text>' +
      midLabel +
      '<text class="chart-label" text-anchor="end" x="' + (width - padR) + '" y="' + timeY + '">' + escapeHtml(formatTime(usage[usage.length - 1].timestamp)) + '</text>' +
    '</svg>';
  }

  function renderProjects() {
    renderProjectFilterControls();
    var currentProjectKey = projectFilterParams().toString();
    var projectScopePending = projectFiltersActive() && state.projectSummaryKey !== currentProjectKey;
    var projectSummary = projectFiltersActive()
      ? (projectScopePending ? null : state.projectSummary)
      : state.summary;
    var projects = projectSummary && Array.isArray(projectSummary.byProject) ? projectSummary.byProject.slice() : [];
    projects.sort(function (a, b) { return (b.costUsd || 0) - (a.costUsd || 0); });
    if (state.projectQuery) {
      projects = projects.filter(function (project) {
        return String(project.project || '').toLowerCase().indexOf(state.projectQuery) !== -1;
      });
    }
    var allProjectCost = (projectSummary && projectSummary.byProject || []).reduce(function (sum, project) { return sum + (project.costUsd || 0); }, 0);
    var table = byId('projectsTable');
    renderProjectFilterSummary(projectSummary);

    if ((state.projectLoading || projectScopePending) && !projectSummary) {
      table.innerHTML = '<div class="empty-state compact">Updating filtered local usage…</div>';
    } else if (projects.length === 0) {
      var emptyCopy = state.projectQuery
        ? 'No projects match “' + escapeHtml(state.projectQuery) + '” in this usage scope.'
        : 'No project usage matches the selected filters.';
      table.innerHTML = '<div class="empty-state">' + emptyCopy + '</div>';
    } else {
      var rows = projects.map(function (project) {
        var expanded = state.expandedProject === project.project;
        var share = allProjectCost > 0 ? (project.costUsd || 0) / allProjectCost : 0;
        var shownSessions = expanded ? project.sessions.slice(0, 8) : [];
        var topSessionCost = shownSessions.reduce(function (max, session) { return Math.max(max, finiteOr0(session.costUsd)); }, 0) || 1;
        var sessions = expanded ? '<div class="project-session-details">' +
          '<div class="project-session-head"><span>Sessions in this project</span><span>' + escapeHtml(project.sessions.length > shownSessions.length ? 'Showing ' + shownSessions.length + ' of ' + project.sessions.length : project.sessions.length + ' total') + '</span></div>' +
          shownSessions.map(function (session) {
          return '<div class="project-session-row"><span class="ps-id"><code title="' + escapeHtmlAttr(session.sessionId || '') + '">' + escapeHtml(String(session.sessionId || '').slice(0, 12)) + '</code><small>' + escapeHtml(formatNumber(session.messageCount || 0) + ' messages · ' + formatRelative(session.lastTimestamp, (projectSummary || state.summary).generatedAt)) + '</small></span>' +
            '<span class="ps-bar" aria-hidden="true"><span style="width:' + ((finiteOr0(session.costUsd) / topSessionCost) * 100).toFixed(1) + '%"></span></span>' +
            '<span>' + escapeHtml(formatCompact(session.tokenTotal || 0)) + ' tokens</span><strong>' + escapeHtml(formatCost(session.costUsd || 0)) + estimateBadge(session.estimatedCostUsed) + '</strong></div>';
        }).join('') + '</div>' : '';
        return '<button type="button" class="project-table-row' + (expanded ? ' expanded' : '') + '" data-project-row="' + escapeHtmlAttr(project.project) + '" aria-expanded="' + expanded + '">' +
          '<span class="project-name-cell"><i class="project-avatar tone-' + projectTone(project.project) + '">' + escapeHtml(projectInitial(project.project)) + '</i><span><strong title="' + escapeHtmlAttr(project.project) + '">' + escapeHtml(shortProjectName(project.project)) + '</strong><span>' + escapeHtml(project.project) + '</span></span></span>' +
          '<span class="table-number">' + project.sessions.length + '</span>' +
          '<span class="table-number">' + escapeHtml(formatCompact(project.tokenTotal || 0)) + '</span>' +
          '<span class="table-number strong">' + escapeHtml(formatCost(project.costUsd || 0)) + estimateBadge(project.estimatedCostUsed) + '</span>' +
          '<span class="share-cell"><span class="share-bar"><span style="width:' + (share * 100).toFixed(2) + '%"></span></span><span class="table-number">' + escapeHtml(formatPercent(share)) + '</span><i class="row-chevron" aria-hidden="true"></i></span>' +
        '</button>' + sessions;
      }).join('');
      table.innerHTML = '<div class="table-head"><span>Project</span><span>Sessions</span><span>Tokens</span><span>Est. cost</span><span>Cost share</span></div>' + rows;
      table.querySelectorAll('[data-project-row]').forEach(function (row) {
        row.addEventListener('click', function () {
          var project = row.getAttribute('data-project-row');
          state.expandedProject = state.expandedProject === project ? null : project;
          renderProjects();
        });
      });
    }
    renderBranches(projectSummary);
    renderWhatIf(projectSummary);
  }

  function renderWhatIf(projectSummary) {
    var target = byId('whatIfRows');
    var select = byId('whatIfProject');
    var whatIf = projectSummary && projectSummary.whatIf;
    var projects = whatIf && Array.isArray(whatIf.byProject) ? whatIf.byProject : [];

    var optionsKey = projects.map(function (project) { return project.project; }).join('\n');
    if (optionsKey !== state.whatIfOptionsKey) {
      state.whatIfOptionsKey = optionsKey;
      var allOption = document.createElement('option');
      allOption.value = '';
      allOption.textContent = 'All projects in scope';
      select.replaceChildren(allOption);
      projects.forEach(function (project) {
        var option = document.createElement('option');
        option.value = project.project;
        option.textContent = shortProjectName(project.project);
        select.appendChild(option);
      });
    }
    var selected = state.whatIfProject && projects.find(function (project) { return project.project === state.whatIfProject; });
    if (!selected) state.whatIfProject = '';
    select.value = state.whatIfProject;

    var scope = selected || (whatIf && whatIf.scope);
    if (!scope || !Array.isArray(scope.costs) || !(scope.actualCostUsd > 0)) {
      target.innerHTML = '<div class="empty-state compact">What-if pricing appears once this scope has priced usage.</div>';
      return;
    }

    var actual = scope.actualCostUsd;
    var max = Math.max.apply(null, scope.costs.map(function (cost) { return finiteOr0(cost.costUsd); }).concat([actual])) || 1;
    var baseline = ((actual / max) * 100).toFixed(1);
    var row = function (cls, title, subtitle, cost, delta) {
      return '<div class="whatif-row ' + cls + '" role="listitem">' +
        '<div class="whatif-label"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(subtitle) + '</small></div>' +
        '<div class="whatif-bar"><span style="width:' + Math.max(1, (cost / max) * 100).toFixed(1) + '%"></span><i class="whatif-marker" style="left:' + baseline + '%" aria-hidden="true"></i></div>' +
        '<span class="whatif-cost">' + escapeHtml(formatCost(cost)) + '</span>' + delta + '</div>';
    };
    var cheapest = scope.costs.reduce(function (best, cost) {
      return typeof cost.deltaRatio === 'number' && cost.deltaRatio <= -.005 && (!best || cost.costUsd < best.costUsd) ? cost : best;
    }, null);
    var callout = cheapest
      ? '<p class="whatif-callout good"><span><b>' + escapeHtml(cheapest.label) + '</b> would price these tokens at ' + escapeHtml(formatCost(cheapest.costUsd)) + ', ' + escapeHtml(formatCost(-cheapest.deltaUsd)) + ' less than your actual mix.</span></p>'
      : '<p class="whatif-callout"><span>Your actual mix is already the lowest same-token price in this comparison.</span></p>';
    var rows = callout + row('actual', 'Your actual mix', scope.estimated ? 'includes fallback pricing' : 'as recorded', actual,
      '<span class="whatif-delta same">baseline</span>');
    scope.costs.forEach(function (cost) {
      var ratio = typeof cost.deltaRatio === 'number' ? cost.deltaRatio : 0;
      var kind = Math.abs(ratio) < .005 ? 'same' : ratio < 0 ? 'cheaper' : 'pricier';
      var deltaCopy = kind === 'same' ? 'same' : (ratio < 0 ? '−' : '+') + formatPercent(Math.abs(ratio));
      rows += row(kind, cost.label, kind === 'cheaper' ? 'saves ' + formatCost(-cost.deltaUsd) : kind === 'pricier' ? 'costs ' + formatCost(cost.deltaUsd) + ' more' : 'about the same', finiteOr0(cost.costUsd),
        '<span class="whatif-delta ' + kind + '">' + escapeHtml(deltaCopy) + '</span>');
    });
    target.innerHTML = rows;
  }

  function renderBranches(projectSummary) {
    var branches = projectSummary && Array.isArray(projectSummary.byBranch) ? projectSummary.byBranch.slice() : [];
    branches.sort(function (a, b) { return (b.costUsd || 0) - (a.costUsd || 0); });
    var target = byId('branchBreakdown');
    if (branches.length === 0) {
      target.innerHTML = '<div class="empty-state compact">No branch usage matches the selected scope.</div>';
      return;
    }
    var branchCost = branches.reduce(function (sum, branch) { return sum + finiteOr0(branch.costUsd); }, 0);
    target.innerHTML = branches.slice(0, 9).map(function (branch) {
      var share = branchCost > 0 ? finiteOr0(branch.costUsd) / branchCost : 0;
      return '<div class="branch-card">' +
        '<div class="branch-card-head"><span class="branch-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="4.5" cy="3.5" r="1.6" /><circle cx="4.5" cy="12.5" r="1.6" /><circle cx="11.5" cy="5.5" r="1.6" /><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2.2 2.8-5.6 4" /></svg></span>' +
        '<code title="' + escapeHtmlAttr(branch.branch) + '">' + escapeHtml(branch.branch) + '</code><span class="branch-share">' + escapeHtml(formatPercent(share)) + '</span></div>' +
        '<strong class="branch-cost">' + escapeHtml(formatCost(branch.costUsd || 0)) + '</strong>' +
        '<span class="share-bar branch-bar" aria-hidden="true"><span style="width:' + (share * 100).toFixed(2) + '%"></span></span>' +
        '<p class="branch-meta"><span>' + branch.sessions.length + ' session' + (branch.sessions.length === 1 ? '' : 's') + '</span><span>' + escapeHtml(formatCompact(branch.tokenTotal || 0)) + ' tokens</span><span>exact message split</span></p>' +
      '</div>';
    }).join('');
  }

  function renderInsights() {
    var allTips = rankedTips(state.summary.tips || []);
    var hiddenTips = rankedTips(state.summary.hiddenTips || []);
    var warnCount = allTips.filter(function (tip) { return tip.severity === 'warn'; }).length;
    var infoCount = allTips.length - warnCount;
    var savingsUsd = allTips.reduce(function (sum, tip) { return sum + finiteOr0(tip.estimatedSavingsUsd); }, 0);
    var savingsTokens = allTips.reduce(function (sum, tip) { return sum + finiteOr0(tip.estimatedSavingsTokens); }, 0);

    byId('filterAllCount').textContent = allTips.length;
    byId('filterWarnCount').textContent = warnCount;
    byId('filterInfoCount').textContent = infoCount;
    byId('filterHiddenCount').textContent = hiddenTips.length;
    byId('totalSavings').textContent = savingsUsd > 0 ? formatCost(savingsUsd) : (savingsTokens > 0 ? formatCompact(savingsTokens) + ' tok' : '—');
    byId('totalSavingsTokens').textContent = savingsTokens > 0
      ? formatNumber(savingsTokens) + ' estimated tokens · recommendations may overlap'
      : 'Savings appear only when they can be calculated';

    var showingHidden = state.insightFilter === 'hidden';
    var filtered = showingHidden ? hiddenTips : state.insightFilter === 'all' ? allTips : allTips.filter(function (tip) {
      return state.insightFilter === 'warn' ? tip.severity === 'warn' : tip.severity !== 'warn';
    });
    var list = byId('insightsList');
    if (filtered.length === 0) {
      list.innerHTML = showingHidden
        ? '<div class="empty-state-card"><div class="empty-icon">↺</div><h2>Nothing dismissed or snoozed</h2><p>Insights you dismiss or snooze appear here, where you can restore them.</p></div>'
        : '<div class="empty-state-card"><div class="empty-icon">✓</div><h2>No matching recommendations</h2><p>The selected category has no current findings. Insights update automatically as local sessions change.</p></div>';
      return;
    }

    var icons = {
      snooze: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8.5" r="5.5" /><path d="M8 5.8v2.9l1.9 1.2M5.2 1.8 2.8 3.6M10.8 1.8l2.4 1.8" /></svg>',
      dismiss: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg>',
      restore: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7" /><path d="M2.8 2.2v2.6h2.6" /></svg>'
    };
    list.innerHTML = filtered.map(function (tip) {
      var kind = tipKind(tip);
      var saving = savingText(tip);
      var id = escapeHtmlAttr(tip.id || '');
      var warn = tip.severity === 'warn';
      var hiddenStatus = showingHidden && tip.userState && tip.userState.status === 'snoozed' ? 'snoozed' : 'dismissed';
      var actions = showingHidden
        ? '<button class="insight-action restore" type="button" data-insight-action="restore" data-insight-id="' + id + '">' + icons.restore + 'Restore</button>'
        : '<button class="insight-action" type="button" data-insight-action="snooze" data-insight-days="1" data-insight-id="' + id + '">' + icons.snooze + 'Snooze 1 day</button>' +
          '<button class="insight-action" type="button" data-insight-action="snooze" data-insight-days="7" data-insight-id="' + id + '">' + icons.snooze + 'Snooze 7 days</button>' +
          '<button class="insight-action subtle" type="button" data-insight-action="dismiss" data-insight-id="' + id + '">' + icons.dismiss + 'Dismiss</button>';
      var stateChip = showingHidden ? '<span class="insight-hidden-note ' + hiddenStatus + '">' + escapeHtml(hiddenStateText(tip.userState) || 'Hidden') + '</span>' : '';
      return '<article class="insight-card ' + (warn ? 'warn' : 'info') + (showingHidden ? ' muted' : '') + '">' +
        '<span class="insight-icon ' + (warn ? 'warn' : '') + '" aria-hidden="true">' + insightIcon(tip, kind) + '</span>' +
        '<div class="insight-copy"><div class="insight-title-row"><h3>' + escapeHtml(kind.label) + '</h3>' + stateChip + '</div><p>' + escapeHtml(tip.message || '') + '</p><div class="insight-meta"><span class="severity-badge ' + (warn ? '' : 'info') + '">' + escapeHtml(warn ? 'Attention' : 'Optimize') + '</span><span>Session ' + escapeHtml(String(tip.sessionId || '').slice(0, 12)) + '</span></div>' +
        '<div class="insight-actions" role="group" aria-label="' + escapeHtmlAttr('Manage ' + kind.label) + '">' + actions + '</div></div>' +
        '<div class="insight-side">' + (saving
          ? '<strong class="savings-pill"><b>' + escapeHtml(saving.replace(/ potential$/, '')) + '</b> potential</strong><span>estimated opportunity</span>'
          : '<strong class="savings-pill neutral">Actionable</strong><span>impact not quantified</span>') +
        '<button class="session-button" type="button" data-view-session="' + escapeHtmlAttr(tip.sessionId || '') + '">View session<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" /></svg></button></div>' +
      '</article>';
    }).join('');

    list.querySelectorAll('[data-view-session]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.selectedSessionId = button.getAttribute('data-view-session');
        setView('live');
      });
    });
    list.querySelectorAll('[data-insight-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        updateInsight(button);
      });
    });
  }

  // Line icons for the Insights cards; unknown kinds keep their glyph.
  var INSIGHT_ICON_PATHS = {
    repeatedReads: '<path d="M16.5 7.5A6.5 6.5 0 0 0 4.6 6M3.5 12.5a6.5 6.5 0 0 0 11.9 1.5" /><path d="M4 2.8V6.2h3.4M16 17.2v-3.4h-3.4" />',
    cacheRatio: '<ellipse cx="10" cy="5" rx="6" ry="2.5" /><path d="M4 5v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10v5c0 1.4 2.7 2.5 6 2.5 1.1 0 2.1-.1 3-.4" />',
    longSessionNoCompact: '<path d="M3 7V3h4M17 7V3h-4M3 13v4h4M17 13v4h-4" /><path d="M7.5 10h5" />',
    outlierSessionTotal: '<path d="M3 15.5 8 10l3 3 6-7" /><path d="M13 6h4v4" />',
    largeToolResultSpike: '<rect x="3" y="4" width="14" height="12" rx="2" /><path d="m6.5 8.5 2 1.8-2 1.8M10.5 12.5h3" />'
  };

  function insightIcon(tip, kind) {
    var id = String(tip && tip.id || '');
    var key = Object.keys(INSIGHT_ICON_PATHS).find(function (prefix) { return id.indexOf(prefix) === 0; });
    return key ? '<svg viewBox="0 0 20 20">' + INSIGHT_ICON_PATHS[key] + '</svg>' : escapeHtml(kind.icon);
  }

  function hiddenStateText(userState) {
    if (!userState) return '';
    if (userState.status === 'snoozed') {
      var until = new Date(userState.until);
      return 'Snoozed until ' + (Number.isNaN(until.getTime()) ? 'later' : until.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    }
    return 'Dismissed';
  }

  async function updateInsight(button) {
    var action = button.getAttribute('data-insight-action');
    var days = Number(button.getAttribute('data-insight-days')) || undefined;
    button.disabled = true;
    try {
      var response = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: button.getAttribute('data-insight-id'), action: action, days: days })
      });
      if (!response.ok) throw new Error('Insight update failed');
      var summaryResponse = await fetch('/api/summary', { cache: 'no-store' });
      if (!summaryResponse.ok) throw new Error('Could not refresh the dashboard');
      receiveSummary(await summaryResponse.json());
      showToast(action === 'restore' ? 'Insight restored.' : action === 'dismiss' ? 'Insight dismissed. Find it under Dismissed & snoozed.' : 'Insight snoozed for ' + days + ' day' + (days === 1 ? '' : 's') + '.');
    } catch (error) {
      button.disabled = false;
      showToast('Could not update this insight. Please try again.');
    }
  }

  function renderSettings() {
    if (state.settingsHydrated) return;
    var config = state.summary.config || {};
    setInputValue('dailyTokenCap', config.dailyTokenCap);
    setInputValue('dailyCostCapUsd', config.dailyCostCapUsd);
    setInputValue('sessionCostCapUsd', config.sessionCostCapUsd);
    setInputValue('monthlyCostCapUsd', config.monthlyCostCapUsd);
    setInputValue('monthlyTokenCap', config.monthlyTokenCap);
    setInputValue('warnThresholdPct', config.warnThresholdPct == null ? 80 : config.warnThresholdPct);
    byId('planSelect').value = config.plan || 'api';
    setInputValue('planMonthlyUsd', config.planMonthlyUsd);
    setInputValue('blockTokenLimit', config.blockTokenLimit);
    setInputValue('weeklyTokenLimit', config.weeklyTokenLimit);
    byId('pricingVerifiedOn').textContent = valueAt(state.summary, ['pricing', 'verifiedOn'], 'Unknown');
    state.settingsHydrated = true;
  }

  function setInputValue(id, value) {
    byId(id).value = value == null ? '' : String(value);
  }

  function hydrateProjectFilterState() {
    var params = new URLSearchParams(window.location.search);
    var range = params.get('range');
    if (['all', '7d', '30d', '90d', 'custom'].indexOf(range) !== -1) state.projectRange = range;
    state.projectModel = (params.get('model') || '').trim();
    state.projectFrom = validLocalDate(params.get('from')) ? params.get('from') : '';
    state.projectTo = validLocalDate(params.get('to')) ? params.get('to') : '';
    if ((state.projectFrom || state.projectTo) && state.projectRange === 'all') state.projectRange = 'custom';
  }

  function hydrateProjectModelOptions(summary) {
    if (!dom.projectModel) return;
    var models = new Set();
    (Array.isArray(summary.sessions) ? summary.sessions : []).forEach(function (session) {
      (Array.isArray(session.models) ? session.models : []).forEach(function (model) {
        if (model) models.add(String(model));
      });
    });
    var values = Array.from(models).sort(function (a, b) { return a.localeCompare(b); });
    if (state.projectModel && values.indexOf(state.projectModel) === -1) values.unshift(state.projectModel);
    dom.projectModel.replaceChildren();
    var allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All models';
    dom.projectModel.appendChild(allOption);
    values.forEach(function (model) {
      var option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      dom.projectModel.appendChild(option);
    });
    dom.projectModel.value = state.projectModel;
    renderProjectFilterControls();
  }

  function projectFiltersChanged() {
    state.expandedProject = null;
    state.projectSummaryKey = null;
    state.projectError = '';
    renderProjectFilterControls();
    syncProjectFilterUrl();
    refreshProjectSummary();
  }

  function renderProjectFilterControls() {
    document.querySelectorAll('[data-project-range]').forEach(function (button) {
      var active = button.getAttribute('data-project-range') === state.projectRange;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (dom.projectModel) dom.projectModel.value = state.projectModel;
    if (dom.projectFrom) dom.projectFrom.value = state.projectFrom;
    if (dom.projectTo) dom.projectTo.value = state.projectTo;
    if (dom.customRangeFields) dom.customRangeFields.classList.toggle('hidden', state.projectRange !== 'custom');
    if (dom.clearProjectFilters) dom.clearProjectFilters.disabled = !projectFiltersActive();
  }

  function projectFiltersActive() {
    return state.projectRange !== 'all' || Boolean(state.projectModel);
  }

  function projectScopePending() {
    return projectFiltersActive() && state.projectSummaryKey !== projectFilterParams().toString();
  }

  function projectFilterParams() {
    var params = new URLSearchParams();
    var dates = projectDateBounds();
    if (dates.from) params.set('from', dates.from);
    if (dates.to) params.set('to', dates.to);
    if (state.projectModel) params.set('model', state.projectModel);
    return params;
  }

  function projectDateBounds() {
    if (state.projectRange === 'custom') return { from: state.projectFrom || '', to: state.projectTo || '' };
    var days = state.projectRange === '7d' ? 7 : state.projectRange === '30d' ? 30 : state.projectRange === '90d' ? 90 : 0;
    if (!days) return { from: '', to: '' };
    var end = new Date();
    end.setHours(12, 0, 0, 0);
    var start = new Date(end.getTime());
    start.setDate(start.getDate() - (days - 1));
    return { from: localDateString(start), to: localDateString(end) };
  }

  function localDateString(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function validLocalDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    var parsed = new Date(value + 'T12:00:00');
    return !Number.isNaN(parsed.getTime()) && localDateString(parsed) === value;
  }

  function syncProjectFilterUrl() {
    var url = new URL(window.location.href);
    ['range', 'model', 'from', 'to'].forEach(function (key) { url.searchParams.delete(key); });
    if (state.projectRange !== 'all') url.searchParams.set('range', state.projectRange);
    if (state.projectModel) url.searchParams.set('model', state.projectModel);
    if (state.projectRange === 'custom') {
      if (state.projectFrom) url.searchParams.set('from', state.projectFrom);
      if (state.projectTo) url.searchParams.set('to', state.projectTo);
    }
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  function scheduleProjectRefresh() {
    window.clearTimeout(state.projectRefreshTimer);
    state.projectRefreshTimer = window.setTimeout(refreshProjectSummary, 220);
  }

  async function refreshProjectSummary() {
    if (!state.summary) return;
    var requestId = ++state.projectRequestId;
    var params = projectFilterParams();
    var filterKey = params.toString();
    if (state.projectRange === 'custom' && state.projectFrom && state.projectTo && state.projectFrom > state.projectTo) {
      state.projectError = 'Start date must not be after end date.';
      state.projectLoading = false;
      renderProjects();
      return;
    }
    if (filterKey === '') {
      state.projectSummary = state.summary;
      state.projectSummaryKey = '';
      state.projectLoading = false;
      state.projectError = '';
      renderProjects();
      return;
    }
    state.projectLoading = true;
    state.projectError = '';
    if (state.view === 'projects') renderProjects();
    try {
      var response = await fetch('/api/summary?' + filterKey, { cache: 'no-store' });
      if (!response.ok) throw new Error('Filtered summary request failed');
      var nextSummary = await response.json();
      if (requestId !== state.projectRequestId) return;
      state.projectSummary = nextSummary;
      state.projectSummaryKey = filterKey;
    } catch (error) {
      if (requestId === state.projectRequestId) {
        state.projectError = 'Could not refresh this local usage scope.';
      }
    } finally {
      if (requestId === state.projectRequestId) {
        state.projectLoading = false;
        if (state.view === 'projects') renderProjects();
      }
    }
  }

  function renderProjectFilterSummary(projectSummary) {
    if (!dom.projectFilterSummary) return;
    if (state.projectError) {
      dom.projectFilterSummary.className = 'explorer-summary error';
      dom.projectFilterSummary.textContent = state.projectError;
      return;
    }
    if (state.projectLoading || projectScopePending()) {
      dom.projectFilterSummary.className = 'explorer-summary';
      dom.projectFilterSummary.textContent = 'Updating filtered local usage…';
      return;
    }
    var totals = projectSummary && projectSummary.allTime ? projectSummary.allTime : {};
    var projectCount = projectSummary && Array.isArray(projectSummary.byProject) ? projectSummary.byProject.length : 0;
    var estimated = projectSummary && Array.isArray(projectSummary.sessions) && projectSummary.sessions.some(function (session) {
      return session.estimatedCostUsed === true;
    });
    var rangeLabels = { all: 'All local usage', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', custom: 'Custom range' };
    var scope = rangeLabels[state.projectRange] || 'All local usage';
    if (state.projectRange === 'custom') {
      if (state.projectFrom && state.projectTo) scope += ' · ' + state.projectFrom + ' to ' + state.projectTo;
      else if (state.projectFrom) scope += ' · from ' + state.projectFrom;
      else if (state.projectTo) scope += ' · through ' + state.projectTo;
      else scope += ' · choose dates to narrow usage';
    }
    if (state.projectModel) scope += ' · ' + state.projectModel;
    dom.projectFilterSummary.className = 'explorer-summary' + (estimated ? ' estimated' : '');
    dom.projectFilterSummary.textContent = scope + ' · ' + projectCount + ' project' + (projectCount === 1 ? '' : 's') +
      ' · ' + formatNumber(totals.tokenTotal || 0) + ' tokens · ' + formatCost(totals.costUsd || 0) +
      (estimated ? ' · some cost uses fallback pricing' : '');
  }

  function rankedTips(tips) {
    return (Array.isArray(tips) ? tips.slice() : []).sort(function (a, b) {
      if ((a.severity === 'warn') !== (b.severity === 'warn')) return a.severity === 'warn' ? -1 : 1;
      return finiteOr0(b.estimatedSavingsUsd) - finiteOr0(a.estimatedSavingsUsd);
    });
  }

  function tipKind(tip) {
    var id = String(tip && tip.id || '');
    for (var i = 0; i < TIP_KINDS.length; i++) {
      if (id.indexOf(TIP_KINDS[i].prefix) === 0) return TIP_KINDS[i];
    }
    return { icon: '✦', label: 'Usage opportunity' };
  }

  function savingText(tip) {
    if (tip && typeof tip.estimatedSavingsUsd === 'number' && Number.isFinite(tip.estimatedSavingsUsd)) {
      return tip.estimatedSavingsUsd > 0 && tip.estimatedSavingsUsd < .01
        ? '<$0.01 potential'
        : formatCost(tip.estimatedSavingsUsd) + ' potential';
    }
    if (tip && typeof tip.estimatedSavingsTokens === 'number' && Number.isFinite(tip.estimatedSavingsTokens)) {
      return formatCompact(tip.estimatedSavingsTokens) + ' tok potential';
    }
    return '';
  }

  function lastPathSegment(project) {
    var parts = String(project || '').split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function projectTone(project) {
    var text = String(project || '');
    var hash = 0;
    for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return hash % 5;
  }

  function projectInitial(project) {
    // Up to two initials from the folder name: "synthetic-alpha" -> "SA".
    var words = lastPathSegment(project).split(/[-_.\s]+/).filter(Boolean);
    if (words.length === 0) return '?';
    return (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : words[0].charAt(1) || '')).toUpperCase();
  }

  function shortProjectName(project) {
    var raw = String(project || 'unknown');
    var parts = raw.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) return 'unknown';
    return parts.length === 1 ? parts[0] : parts.slice(-2).join('/');
  }

  function formatNumber(value) {
    return Math.round(finiteOr0(value)).toLocaleString();
  }

  function formatCompact(value) {
    var number = finiteOr0(value);
    var abs = Math.abs(number);
    if (abs >= 1e9) return trimNumber(number / 1e9, 2) + 'B';
    if (abs >= 1e6) return trimNumber(number / 1e6, 2) + 'M';
    if (abs >= 1e3) return trimNumber(number / 1e3, 1) + 'K';
    return String(Math.round(number));
  }

  function trimNumber(value, digits) {
    return value.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
  }

  function formatCost(value) {
    var number = finiteOr0(value);
    if (number > 0 && number < .01) return '<$0.01';
    return '$' + number.toFixed(2);
  }

  function formatPercent(ratio) {
    return (finiteOr0(ratio) * 100).toFixed(ratio > 0 && ratio < .01 ? 1 : 0) + '%';
  }

  function formatTime(timestamp) {
    var date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatRelative(timestamp, nowTimestamp) {
    var time = timestampOf(timestamp);
    var now = timestampOf(nowTimestamp);
    if (!Number.isFinite(time) || !Number.isFinite(now)) return 'at an unknown time';
    var seconds = Math.max(0, Math.round((now - time) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return seconds + 's ago';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.round(hours / 24) + 'd ago';
  }

  function formatDuration(first, last) {
    var start = timestampOf(first);
    var end = timestampOf(last);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'Unknown';
    var minutes = Math.max(1, Math.round((end - start) / 60_000));
    if (minutes < 60) return minutes + 'm';
    var hours = Math.floor(minutes / 60);
    if (hours >= 48) {
      var days = Math.floor(hours / 24);
      return days + 'd' + (hours % 24 ? ' ' + (hours % 24) + 'h' : '');
    }
    var remaining = minutes % 60;
    return hours + 'h' + (remaining ? ' ' + remaining + 'm' : '');
  }

  function formatDay(timestamp) {
    var date = new Date(timestamp);
    return Number.isNaN(date.getTime())
      ? 'at an unknown time'
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + formatTime(timestamp);
  }

  function finiteOr0(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function timestampOf(value) {
    var parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function valueAt(object, path, fallback) {
    var value = object;
    for (var i = 0; i < path.length; i++) {
      if (value == null || typeof value !== 'object') return fallback;
      value = value[path[i]];
    }
    return value == null ? fallback : value;
  }

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = String(value == null ? '' : value);
    return div.innerHTML;
  }

  function escapeHtmlAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function renderAlertStrip(alerts) {
    var strip = byId('alertStrip');
    var list = Array.isArray(alerts) ? alerts.slice() : [];
    list.sort(function (a, b) { return (b.level === 'exceeded') - (a.level === 'exceeded'); });
    strip.classList.toggle('hidden', list.length === 0);
    strip.innerHTML = list.slice(0, 4).map(function (alert) {
      var level = alert.level === 'exceeded' ? 'exceeded' : 'warn';
      return '<div class="alert-item ' + level + '"><strong>' + (level === 'exceeded' ? 'Over limit' : 'Heads up') + '</strong><span>' + escapeHtml(alert.message || '') + '</span></div>';
    }).join('');
  }

  function notificationsSupported() {
    return typeof window.Notification === 'function';
  }

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Preferences still apply for this page view when storage is blocked.
    }
  }

  function notificationsEnabled() {
    return notificationsSupported() && window.Notification.permission === 'granted' && state.notifyEnabled;
  }

  function bindNotifications() {
    state.notifyEnabled = readStorage(NOTIFY_KEY) === 'on';
    try {
      state.notified = JSON.parse(readStorage(NOTIFIED_KEY) || '{}') || {};
    } catch {
      state.notified = {};
    }
    var toggle = byId('notifyToggle');
    var testButton = byId('notifyTest');

    toggle.addEventListener('change', async function () {
      if (!toggle.checked) {
        state.notifyEnabled = false;
        writeStorage(NOTIFY_KEY, 'off');
        syncNotificationControls();
        return;
      }
      if (notificationsSupported() && window.Notification.permission === 'default') {
        try {
          await window.Notification.requestPermission();
        } catch {
          // Treated as not granted below.
        }
      }
      state.notifyEnabled = notificationsSupported() && window.Notification.permission === 'granted';
      writeStorage(NOTIFY_KEY, state.notifyEnabled ? 'on' : 'off');
      syncNotificationControls();
      if (state.notifyEnabled && state.summary) notifyAlerts(state.summary.alerts);
    });

    testButton.addEventListener('click', function () {
      if (!notificationsEnabled()) return;
      showDesktopNotification('test', 'Notifications are working. You will hear from CC Token Meter when a budget or plan limit is close.');
    });

    syncNotificationControls();
  }

  function syncNotificationControls() {
    var toggle = byId('notifyToggle');
    var status = byId('notifyStatus');
    var testButton = byId('notifyTest');
    status.className = 'notify-status';
    if (!notificationsSupported()) {
      toggle.checked = false;
      toggle.disabled = true;
      testButton.disabled = true;
      status.textContent = 'This browser does not support desktop notifications.';
      return;
    }
    var permission = window.Notification.permission;
    toggle.disabled = false;
    toggle.checked = state.notifyEnabled && permission === 'granted';
    testButton.disabled = !toggle.checked;
    if (permission === 'denied') {
      status.className = 'notify-status error';
      status.textContent = 'Notifications are blocked for this page. Allow them in your browser\'s site settings, then turn this on again.';
    } else if (toggle.checked) {
      status.textContent = 'On. Each alert notifies once per level per day, or once per 5-hour window.';
    } else {
      status.textContent = 'Off. Alerts still appear at the top of Overview.';
    }
  }

  function notifyAlerts(alerts) {
    if (!Array.isArray(alerts) || alerts.length === 0) return;
    var enabled = notificationsEnabled();
    var now = Date.now();
    var today = localDateString(new Date());
    var changed = false;
    Object.keys(state.notified).forEach(function (key) {
      if (now - state.notified[key] > NOTIFIED_TTL_MS) {
        delete state.notified[key];
        changed = true;
      }
    });
    if (enabled) {
      alerts.forEach(function (alert) {
        if (!alert || !alert.id) return;
        // Day and session alerts repeat each day; window ids already include
        // the window start, so each window notifies on its own.
        var key = alert.id + '|' + alert.level + '|' + today;
        if (state.notified[key]) return;
        state.notified[key] = now;
        changed = true;
        if (document.hidden) showDesktopNotification(alert.id, alert.message);
        else showToast(alert.message);
      });
    }
    if (changed) writeStorage(NOTIFIED_KEY, JSON.stringify(state.notified));
  }

  function showDesktopNotification(tag, message) {
    try {
      var notification = new window.Notification('CC Token Meter', { body: String(message || ''), tag: 'cc-token-meter:' + tag });
      notification.addEventListener('click', function () {
        window.focus();
        setView('overview', true, true);
        notification.close();
      });
    } catch {
      showToast(message);
    }
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add('visible');
    state.toastTimer = window.setTimeout(function () {
      dom.toast.classList.remove('visible');
    }, 2600);
  }

  function setConnection(mode, label) {
    dom.connectionStatus.className = 'connection-pill ' + mode;
    dom.connectionStatus.querySelector('.connection-copy').textContent = label;
  }

  async function connect() {
    setConnection('connecting', 'Connecting');
    try {
      var response = await fetch('/api/summary', { cache: 'no-store' });
      if (response.ok) receiveSummary(await response.json());
    } catch {
      // The SSE connection below remains the source of truth and retries.
    }

    var source = new EventSource('/api/stream');
    source.addEventListener('open', function () {
      setConnection('', 'Live · local');
    });
    source.addEventListener('message', function (event) {
      try {
        receiveSummary(JSON.parse(event.data));
        setConnection('', 'Live · local');
      } catch {
        setConnection('disconnected', 'Invalid local data');
      }
    });
    source.addEventListener('error', function () {
      setConnection('disconnected', 'Reconnecting');
    });
  }
})();
