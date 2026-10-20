// Dashboard: date-range filter, KPI cards, charts, recent entries.
const Dashboard = (() => {
  const { esc, inr } = UI;
  const charts = [];
  let range = null; // remembered for the session

  function defaultRange() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return { from: UI.isoDate(from), to: UI.today() };
  }

  function presetRange(p) {
    const now = new Date();
    const to = UI.today();
    if (p === '3m') return defaultRange();
    if (p === '6m') return { from: UI.isoDate(new Date(now.getFullYear(), now.getMonth() - 5, 1)), to };
    if (p === '12m') return { from: UI.isoDate(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to };
    if (p === 'fy') {
      const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY: Apr–Mar
      return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
    }
    return { from: '2000-01-01', to };
  }

  /** Chart colours from CSS tokens (validated pair: saffron + maroon, separate light/dark steps). */
  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    return { s1: v('--series-1'), s2: v('--series-2'), text: v('--text-2'), grid: v('--grid'), surface: v('--surface') };
  }

  function destroyCharts() { while (charts.length) charts.pop().destroy(); }

  async function render(el) {
    range = range || defaultRange();
    el.innerHTML = `
      <div class="page-head"><h1>Dashboard</h1></div>
      <form class="filters range-form" id="range-form">
        <label class="field-inline"><span>From</span><input type="date" name="from" value="${range.from}" required></label>
        <label class="field-inline"><span>To</span><input type="date" name="to" value="${range.to}" required></label>
        <button class="btn btn-primary btn-sm" type="submit">Apply</button>
        <div class="presets">
          ${[['3m', '3 months'], ['6m', '6 months'], ['12m', '12 months'], ['fy', 'This FY'], ['all', 'All']].map(([k, l]) =>
            `<button type="button" class="chip-btn" data-preset="${k}">${l}</button>`).join('')}
        </div>
      </form>
      <div id="dash-body">${UI.spinner()}</div>`;
    const form = el.querySelector('#range-form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const from = form.elements.namedItem('from').value, to = form.elements.namedItem('to').value;
      if (from > to) return UI.toast('“From” must be before “To”', 'error');
      range = { from, to };
      load(el);
    });
    el.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
      range = presetRange(b.dataset.preset);
      form.elements.namedItem('from').value = range.from;
      form.elements.namedItem('to').value = range.to;
      load(el);
    }));
    await load(el);
  }

  async function load(el) {
    const body = el.querySelector('#dash-body');
    body.innerHTML = UI.spinner();
    const d = await Api.call('getDashboard', range);
    if (!body.isConnected) return;
    destroyCharts();
    const b = d.bsc, p = d.preaching;
    body.innerHTML = `
      <div class="kpis">
        ${kpi('BSC total income', inr(b.income), 'excl. carried-forward balance')}
        ${kpi('BSC total expenditure', inr(b.expense), `${d.monthly.length} month${d.monthly.length === 1 ? '' : 's'}`)}
        ${kpi('BSC net loss', inr(b.loss), `HELP covered ${inr(b.coverage)} · gap ${inr(b.gap)}`, b.loss > 0 ? 'neg' : '')}
        ${kpi('Preaching total spent', inr(p.spent), `${p.count} event${p.count === 1 ? '' : 's'} · ${p.plates} plates`)}
        ${kpi('Preaching donations', inr(p.donations), `net ${inr(p.donations - p.spent, { sign: true })}`)}
        ${kpi('Current balance', inr(d.currentBalance), d.currentBalanceMonth ? 'closing of ' + UI.monthLabel(d.currentBalanceMonth) : 'no months yet', 'strong')}
      </div>
      <div class="chart-grid">
        <section class="card chart-card"><h2>Spending: BSC loss vs preaching</h2><div class="chart-box chart-donut"><canvas id="c-donut" role="img" aria-label="Donut chart: BSC loss ${inr(b.loss)}, preaching ${inr(p.spent)}"></canvas></div></section>
        <section class="card chart-card"><h2>BSC income vs expenditure by month</h2><div class="chart-box"><canvas id="c-month" role="img" aria-label="Bar chart of monthly BSC income and expenditure"></canvas></div></section>
        <section class="card chart-card"><h2>BSC expense by purpose</h2><div class="chart-box" id="purpose-box"><canvas id="c-purpose" role="img" aria-label="Bar chart of BSC expenses by purpose"></canvas></div></section>
        <section class="card chart-card"><h2>Cost per preaching event</h2><div class="chart-box" id="event-box"><canvas id="c-events" role="img" aria-label="Bar chart of total cost per preaching event"></canvas></div></section>
      </div>
      <section class="card">
        <div class="card-head"><h2>Recent entries</h2></div>
        <ul class="list recent">${d.recent.length ? d.recent.map(r => `
          <li><a class="list-row" href="#/${esc(r.link)}">
            <span class="kind kind-${esc(r.kind.toLowerCase().replace(/\s+/g, '-'))}">${esc(r.kind)}</span>
            <div class="grow"><div class="ellipsis">${esc(r.label || '—')}</div>
              <div class="muted small ellipsis">${r.parent ? esc(r.parent) + ' · ' : ''}${r.edited ? 'edited' : 'added'} by <strong>${esc(r.by || '—')}</strong> · ${esc(UI.relTime(r.at))}</div></div>
            ${r.amount !== null ? `<span class="amt">${inr(r.amount)}</span>` : ''}
          </a></li>`).join('') : '<li class="muted">Nothing yet</li>'}</ul>
      </section>`;
    drawCharts(body, d);
  }

  const kpi = (label, value, sub, cls = '') =>
    `<div class="card kpi ${cls}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${esc(sub)}</div></div>`;

  function emptyChart(canvas, msg) {
    canvas.parentElement.innerHTML = `<p class="chart-empty muted">${esc(msg)}</p>`;
  }

  function drawCharts(body, d) {
    if (typeof Chart === 'undefined') {
      body.querySelectorAll('canvas').forEach(c => emptyChart(c, 'Charts unavailable offline'));
      return;
    }
    const c = palette();
    Chart.defaults.color = c.text;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.borderColor = c.grid;
    const money = v => inr(v);
    const tooltip = { callbacks: { label: ctx => `${ctx.dataset.label || ctx.label}: ${money(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed)}` } };
    const barBase = { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 36, borderWidth: 0 };
    const axisMoney = { grid: { color: c.grid }, border: { display: false }, ticks: { callback: v => '₹' + new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) } };
    const axisCat = { grid: { display: false }, border: { color: c.grid } };

    // Donut — BSC loss vs preaching spend.
    const donut = body.querySelector('#c-donut');
    if (d.bsc.loss + d.preaching.spent <= 0) emptyChart(donut, 'No loss or preaching spend in this range');
    else charts.push(new Chart(donut, {
      type: 'doughnut',
      data: { labels: ['BSC loss', 'Preaching'], datasets: [{ data: [d.bsc.loss, d.preaching.spent], backgroundColor: [c.s2, c.s1], borderColor: c.surface, borderWidth: 2, hoverOffset: 4 }] },
      options: {
        maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: ctx => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            return `${ctx.label}: ${money(ctx.parsed)} (${Math.round(ctx.parsed / total * 100)}%)`;
          } } }
        }
      }
    }));

    // Month-wise income vs expenditure.
    const mc = body.querySelector('#c-month');
    if (!d.monthly.length) emptyChart(mc, 'No BSC months in this range');
    else charts.push(new Chart(mc, {
      type: 'bar',
      data: {
        labels: d.monthly.map(m => UI.monthLabel(m.Month)),
        datasets: [
          Object.assign({ label: 'Income', data: d.monthly.map(m => m.income), backgroundColor: c.s1 }, barBase),
          Object.assign({ label: 'Expenditure', data: d.monthly.map(m => m.expense), backgroundColor: c.s2 }, barBase)
        ]
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { x: axisCat, y: Object.assign({ beginAtZero: true }, axisMoney) },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip }
      }
    }));

    // Horizontal bars (single series → no legend; title names it).
    const hbar = (canvas, box, labels, values, color, onClick) => {
      box.style.height = Math.max(180, labels.length * 30 + 40) + 'px';
      charts.push(new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [Object.assign({ label: 'Amount', data: values, backgroundColor: color }, barBase, { maxBarThickness: 22 })] },
        options: {
          indexAxis: 'y', maintainAspectRatio: false,
          scales: { x: Object.assign({ beginAtZero: true }, axisMoney), y: Object.assign({}, axisCat, { ticks: { autoSkip: false } }) },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => money(ctx.parsed.x) } } },
          onClick: onClick ? (evt, els) => { if (els.length) onClick(els[0].index); } : undefined,
          onHover: onClick ? (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; } : undefined
        }
      }));
    };

    const pc = body.querySelector('#c-purpose');
    if (!d.expenseByPurpose.length) emptyChart(pc, 'No BSC expenses in this range');
    else hbar(pc, body.querySelector('#purpose-box'), d.expenseByPurpose.map(x => x.purpose), d.expenseByPurpose.map(x => x.amount), c.s2);

    const ec = body.querySelector('#c-events');
    if (!d.events.length) emptyChart(ec, 'No preaching events in this range');
    else hbar(ec, body.querySelector('#event-box'),
      d.events.map(e => `${UI.fmtDate(e.Date).replace(/ \d{4}$/, '')} · ${e.Name || (e.SubType === 'SUNDAY_LOVE_FEAST' ? 'SLF' : 'One Time')}`),
      d.events.map(e => e.totalExpense), c.s1,
      i => App.go('#/event/' + encodeURIComponent(d.events[i].EventID)));
  }

  // Re-colour charts when the theme changes.
  document.addEventListener('themechange', () => {
    if (!charts.length) return;
    const page = document.querySelector('#dash-body');
    if (page) App.route();
  });

  return { render };
})();
