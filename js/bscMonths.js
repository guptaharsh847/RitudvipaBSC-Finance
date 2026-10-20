// BSC monthly accounts: list of months, month detail with income/expense tables and live summary.
const BscMonths = (() => {
  const C = window.APP_CONFIG;
  const { esc, inr, num, round2 } = UI;

  const isBscBearer = b => {
    const s = String(b || '').trim().toLowerCase();
    return !s || /\bbsc\b/.test(s) || s.includes('ritudwip') || s.includes('ritudvipa');
  };

  /** Same rules as backend summarizeMonth_(). Loss = expenditure not met by regular income (before HELP coverage). */
  function summarizeMonth(m, income, expenses) {
    const sum = rows => round2(rows.reduce((s, r) => s + num(r.Amount), 0));
    const byPurpose = rows => {
      const o = {};
      rows.forEach(r => { const k = r.Purpose || '(none)'; o[k] = round2((o[k] || 0) + num(r.Amount)); });
      return o;
    };
    const totalIncome = sum(income);
    const totalExpense = sum(expenses);
    const carry = sum(income.filter(r => r.Purpose === C.PURPOSE_CARRY));
    const coverage = sum(income.filter(r => r.Purpose === C.PURPOSE_COVERAGE));
    const operatingResult = round2(totalIncome - carry - coverage - totalExpense);
    const loss = Math.max(0, -operatingResult);
    const personal = {};
    expenses.filter(r => !isBscBearer(r.ExpenseBearedBy)).forEach(r => {
      const k = String(r.ExpenseBearedBy).trim();
      personal[k] = personal[k] || { bearer: k, total: 0, count: 0 };
      personal[k].total = round2(personal[k].total + num(r.Amount));
      personal[k].count++;
    });
    const profitLoss = round2(totalIncome - totalExpense);
    return {
      opening: num(m.OpeningBalance), totalIncome, totalExpense, profitLoss,
      closing: round2(num(m.OpeningBalance) + profitLoss),
      carryForward: carry, coverage, operatingIncome: round2(totalIncome - carry - coverage),
      loss: round2(loss), gap: round2(Math.max(0, loss - coverage)), isLoss: loss > 0,
      incomeByPurpose: byPurpose(income), expenseByPurpose: byPurpose(expenses),
      personal: Object.values(personal), incomeCount: income.length, expenseCount: expenses.length
    };
  }

  let lastList = []; // months from the last list render (for the New-month opening balance helper)

  const lossTitle = ym => `BSC Loss – ${UI.monthLabel(ym)}`;
  const plClass = n => (n < 0 ? 'neg' : n > 0 ? 'pos' : '');

  /* ───────────── List ───────────── */
  async function renderList(el) {
    el.innerHTML = `
      <div class="page-head"><h1>BSC Months</h1>
        <button class="btn btn-primary" id="new-month">＋ New Month</button></div>
      <div id="month-list">${UI.spinner()}</div>`;
    const loading = Api.call('listMonths');
    el.querySelector('#new-month').onclick = async () => {
      try { newMonth(await loading); } catch (e) { UI.fail(e); }
    };
    const months = await loading;
    lastList = months;
    const list = el.querySelector('#month-list');
    if (!months.length) {
      list.innerHTML = `<div class="empty-state"><p>No months yet.</p><p class="muted">Create the first month to start recording income and expenses.</p></div>`;
      return;
    }
    list.innerHTML = `<div class="card-grid">${months.map(m => {
      const s = m.summary;
      return `<a class="card month-card" href="#/month/${encodeURIComponent(m.MonthID)}">
        <div class="mc-head"><h3>${esc(UI.monthLabel(m.Month))}</h3>
          ${s.isLoss ? `<span class="badge badge-loss">Loss ${inr(s.loss)}</span>` : `<span class="badge badge-ok">No loss</span>`}</div>
        <dl class="stats">
          <div><dt>Income</dt><dd>${inr(s.totalIncome)}</dd></div>
          <div><dt>Expenditure</dt><dd>${inr(s.totalExpense)}</dd></div>
          <div><dt>Profit / Loss</dt><dd class="${plClass(s.profitLoss)}">${inr(s.profitLoss, { sign: true })}</dd></div>
          <div><dt>Balance</dt><dd><strong>${inr(s.closing)}</strong></dd></div>
        </dl>
        ${s.isLoss ? `<p class="loss-line">${esc(lossTitle(m.Month))}: ${inr(s.loss)} · HELP ${inr(s.coverage)} · ${s.gap > 0 ? `gap <strong>${inr(s.gap)}</strong>` : 'fully covered'}</p>` : ''}
        <p class="muted small">${s.incomeCount} income · ${s.expenseCount} expense entries</p>
      </a>`;
    }).join('')}</div>`;
  }

  function nextMonth(ym) {
    let [y, m] = ym.split('-').map(Number);
    m++; if (m > 12) { m = 1; y++; }
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  async function newMonth(months) {
    const existing = new Set(months.map(m => m.Month));
    const asc = months.slice().sort((a, b) => a.Month.localeCompare(b.Month));
    let def = UI.today().slice(0, 7);
    if (existing.has(def) && asc.length) def = nextMonth(asc[asc.length - 1].Month);
    const prevClosing = ym => {
      const prev = asc.filter(m => m.Month < ym);
      return prev.length ? prev[prev.length - 1].summary.closing : 0;
    };
    const created = await UI.modal({
      title: 'New month',
      body: `
        <label class="field"><span>Month</span><input type="month" name="Month" required value="${def}"></label>
        <label class="field"><span>Opening balance (₹)</span><input type="number" step="any" inputmode="decimal" name="OpeningBalance" value="${prevClosing(def)}"></label>
        <p class="muted small" id="ob-hint"></p>
        <label class="field"><span>Notes</span><textarea name="Notes" rows="2"></textarea></label>
        <p class="muted small">Opening balance is last month's closing balance. If you also record “${esc(C.PURPOSE_CARRY)}” as an income row, set the opening balance to 0 so it isn't counted twice.</p>
        <p class="form-error" hidden></p>`,
      submitLabel: 'Create month',
      onSubmit: v => {
        if (!/^\d{4}-\d{2}$/.test(v.Month)) throw new Error('Choose a month');
        if (existing.has(v.Month)) throw new Error(`${UI.monthLabel(v.Month)} already exists`);
        return Api.call('createMonth', v);
      }
    });
    if (created) {
      UI.toast(`${UI.monthLabel(created.Month)} created`, 'success');
      App.go('#/month/' + encodeURIComponent(created.MonthID));
    }
  }

  // Keep the opening balance in sync with the chosen month while the "New month" modal is open.
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.name !== 'Month' || t.type !== 'month') return;
    const form = t.form;
    const ob = form && form.querySelector('[name=OpeningBalance]');
    if (!ob) return;
    const prev = lastList.filter(m => m.Month < t.value).sort((a, b) => a.Month.localeCompare(b.Month));
    ob.value = prev.length ? prev[prev.length - 1].summary.closing : 0;
    const hint = form.querySelector('#ob-hint');
    if (hint) hint.textContent = prev.length ? `Closing balance of ${UI.monthLabel(prev[prev.length - 1].Month)}` : 'No earlier month — starting from 0';
  });

  /* ───────────── Detail ───────────── */
  async function renderDetail(el, id) {
    el.innerHTML = UI.spinner();
    const data = await Api.call('getMonth', { MonthID: id });
    const st = { month: data.month, income: data.income, expenses: data.expenses, prevClosing: data.prevClosing };
    const ym = st.month.Month;
    const label = UI.monthLabel(ym);

    el.innerHTML = `
      <div class="page-head">
        <div><a class="back" href="#/months">← Months</a>
          <h1>${esc(st.month.Title || 'BSC Accounts – ' + label)}</h1>
          <p class="muted small" title="${esc(UI.auditTitle(st.month))}">${st.month.Notes ? esc(st.month.Notes) + ' · ' : ''}Created by ${esc(st.month.CreatedBy || '—')}</p></div>
        <div class="head-actions">
          <button class="btn btn-ghost btn-sm" id="edit-month">Edit opening / notes</button>
          <button class="btn btn-ghost btn-sm btn-danger-text" id="del-month">Delete month</button>
        </div>
      </div>
      <div class="mini-summary" id="mini"></div>
      <div class="detail-grid">
        <div class="detail-main">
          <section class="card"><div class="card-head"><h2>Income</h2></div><div id="inc"></div></section>
          <section class="card"><div class="card-head"><h2>Expenses</h2></div><div id="exp"></div></section>
        </div>
        <aside class="detail-side"><div class="card summary" id="summary"></div></aside>
      </div>`;

    const defaultDate = last => {
      if (last && last.Date) return last.Date;
      const t = UI.today();
      return t.startsWith(ym) ? t : ym + '-01';
    };
    const uniq = (rows, key) => [...new Set(rows.map(r => r[key]).filter(Boolean))].sort();

    const refresh = () => renderSummary(el, st);

    new EditableTable(el.querySelector('#inc'), {
      idKey: 'IncomeID', rows: st.income, addLabel: 'Add income', emptyText: 'No income recorded yet', totalKey: 'Amount',
      columns: [
        { key: 'Date', label: 'Date', type: 'date' },
        { key: 'Person', label: 'Person', type: 'list', options: () => uniq(st.income, 'Person') },
        { key: 'Purpose', label: 'Purpose', type: 'select', required: true, options: () => App.cats('INCOME_PURPOSE', 'BSC') },
        { key: 'Amount', label: 'Amount', type: 'money', required: true },
        { key: 'Remarks', label: 'Remarks', type: 'text' }
      ],
      newDefaults: last => ({ Date: defaultDate(last) }),
      describe: r => `${r.Purpose || 'income'} of ${inr(r.Amount)}`,
      onSave: (v, orig) => orig
        ? Api.call('updateIncome', Object.assign({ IncomeID: orig.IncomeID }, v))
        : Api.call('addIncome', Object.assign({ MonthID: id }, v)),
      onDelete: r => Api.call('deleteIncome', { IncomeID: r.IncomeID }),
      onChange: rows => { st.income = rows; refresh(); }
    });

    new EditableTable(el.querySelector('#exp'), {
      idKey: 'ExpenseID', rows: st.expenses, addLabel: 'Add expense', emptyText: 'No expenses recorded yet', totalKey: 'Amount',
      columns: [
        { key: 'Date', label: 'Date', type: 'date' },
        { key: 'Mediator', label: 'Mediator', type: 'list', placeholder: 'Purchasing person', options: () => uniq(st.expenses, 'Mediator') },
        {
          key: 'ExpenseBearedBy', label: 'Beared by', type: 'list',
          options: () => [C.BSC_ACCOUNT_NAME, ...uniq(st.expenses, 'ExpenseBearedBy').filter(x => x !== C.BSC_ACCOUNT_NAME)],
          format: v => isBscBearer(v) ? esc(v || C.BSC_ACCOUNT_NAME) : `${esc(v)} <span class="badge badge-warn" title="Paid personally — to be reimbursed">personal</span>`
        },
        { key: 'Purpose', label: 'Purpose', type: 'select', required: true, options: () => App.cats('EXPENSE_PURPOSE', 'BSC') },
        { key: 'Amount', label: 'Amount', type: 'money', required: true },
        { key: 'Remarks', label: 'Remarks', type: 'text' }
      ],
      newDefaults: last => ({ Date: defaultDate(last), ExpenseBearedBy: (last && last.ExpenseBearedBy) || C.BSC_ACCOUNT_NAME, Mediator: last ? last.Mediator : '' }),
      describe: r => `${r.Purpose || 'expense'} of ${inr(r.Amount)}`,
      onSave: (v, orig) => orig
        ? Api.call('updateBscExpense', Object.assign({ ExpenseID: orig.ExpenseID }, v))
        : Api.call('addBscExpense', Object.assign({ MonthID: id }, v)),
      onDelete: r => Api.call('deleteBscExpense', { ExpenseID: r.ExpenseID }),
      onChange: rows => { st.expenses = rows; refresh(); }
    });

    refresh();

    el.querySelector('#edit-month').onclick = async () => {
      const saved = await UI.modal({
        title: `Edit ${label}`,
        body: `
          <label class="field"><span>Opening balance (₹)</span>
            <input type="number" step="any" inputmode="decimal" name="OpeningBalance" required value="${num(st.month.OpeningBalance)}"></label>
          <button type="button" class="btn btn-ghost btn-sm" id="use-prev" data-value="${num(st.prevClosing)}">Use previous month's closing: ${inr(st.prevClosing || 0)}</button>
          <label class="field"><span>Notes</span><textarea name="Notes" rows="3">${esc(st.month.Notes || '')}</textarea></label>
          <p class="form-error" hidden></p>`,
        onSubmit: v => Api.call('updateMonth', { MonthID: id, OpeningBalance: v.OpeningBalance, Notes: v.Notes })
      });
      if (saved) { st.month = saved; refresh(); UI.toast('Month updated', 'success'); }
    };
    el.querySelector('#del-month').onclick = async () => {
      const n = st.income.length + st.expenses.length;
      if (!(await UI.confirm(`Delete ${label}${n ? ` and its ${n} entries` : ''}? It will be hidden from the app (kept in the sheet as deleted).`, { okLabel: 'Delete month' }))) return;
      try {
        await Api.call('deleteMonth', { MonthID: id });
        UI.toast(`${label} deleted`, 'success');
        App.go('#/months');
      } catch (e) { UI.fail(e); }
    };
  }

  // "Use previous closing" button inside the edit modal.
  document.addEventListener('click', e => {
    if (e.target.id !== 'use-prev') return;
    const inp = e.target.form.querySelector('[name=OpeningBalance]');
    if (inp) inp.value = e.target.dataset.value;
  });

  function purposeRows(obj) {
    const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<p class="muted small">Nothing yet</p>';
    return `<dl class="kv kv-sm">${entries.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${inr(v)}</dd></div>`).join('')}</dl>`;
  }

  function renderSummary(el, st) {
    const s = summarizeMonth(st.month, st.income, st.expenses);
    const ym = st.month.Month;
    el.querySelector('#mini').innerHTML = `
      <span>In <strong>${inr(s.totalIncome)}</strong></span>
      <span>Out <strong>${inr(s.totalExpense)}</strong></span>
      <span>P/L <strong class="${plClass(s.profitLoss)}">${inr(s.profitLoss, { sign: true })}</strong></span>
      <span>Bal <strong>${inr(s.closing)}</strong></span>`;
    el.querySelector('#summary').innerHTML = `
      <h2>Income-Expenditure Summary</h2>
      <dl class="kv">
        <div><dt>Opening balance</dt><dd>${inr(s.opening)}</dd></div>
        <div><dt>Total income</dt><dd>${inr(s.totalIncome)}</dd></div>
        <div><dt>Total expenditure</dt><dd>${inr(s.totalExpense)}</dd></div>
        <div class="kv-strong"><dt>Profit / Loss</dt><dd class="${plClass(s.profitLoss)}">${inr(s.profitLoss, { sign: true })}</dd></div>
        <div class="kv-strong"><dt>Current balance</dt><dd>${inr(s.closing)}</dd></div>
      </dl>
      ${s.isLoss ? `
      <div class="loss-box">
        <h3>${esc(lossTitle(ym))}</h3>
        <dl class="kv kv-sm">
          <div><dt>Loss (expenses not met by regular income)</dt><dd class="neg">${inr(s.loss)}</dd></div>
          <div><dt>${esc(C.PURPOSE_COVERAGE)} received</dt><dd>${inr(s.coverage)}</dd></div>
          <div class="kv-strong"><dt>Remaining gap</dt><dd class="${s.gap > 0 ? 'neg' : 'pos'}">${s.gap > 0 ? inr(s.gap) : 'Fully covered ✓'}</dd></div>
        </dl>
      </div>` : `<p class="ok-line">✓ No BSC loss this month</p>`}
      <details open><summary>Income by purpose</summary>${purposeRows(s.incomeByPurpose)}</details>
      <details open><summary>Expenditure by purpose</summary>${purposeRows(s.expenseByPurpose)}</details>
      ${s.personal.length ? `
      <div class="personal-box">
        <h3>Paid personally by devotee</h3>
        <p class="muted small">Expenses not borne by ${esc(C.BSC_ACCOUNT_NAME)} — for reimbursement tracking.</p>
        <dl class="kv kv-sm">${s.personal.map(p => `<div><dt>${esc(p.bearer)} <span class="muted">(${p.count})</span></dt><dd>${inr(p.total)}</dd></div>`).join('')}</dl>
      </div>` : ''}`;
  }

  return { renderList, renderDetail, summarizeMonth, isBscBearer, lossTitle };
})();
