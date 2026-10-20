// Preaching programs: event list with filters, event detail with menu, plates, donations and expenses.
const Preaching = (() => {
  const { esc, inr, num, round2 } = UI;
  const SUBTYPES = { ONE_TIME: 'One Time', SUNDAY_LOVE_FEAST: 'Sunday Love Feast' };
  const filters = { type: 'ALL', month: '', q: '' };

  const plates = ev => ['StudentPlates', 'InmatePlates', 'OtherPlates'].reduce((s, k) => s + Math.max(0, Math.round(num(ev[k]))), 0);

  /** Same rules as backend summarizeEvent_(). */
  function summarizeEvent(ev, donations, expenses) {
    const sum = rows => round2(rows.reduce((s, r) => s + num(r.Amount), 0));
    const prasadam = sum(expenses.filter(r => r.Section !== 'Other'));
    const other = sum(expenses.filter(r => r.Section === 'Other'));
    const totalExpense = round2(prasadam + other);
    const totalDonations = sum(donations);
    const p = plates(ev);
    return {
      prasadamTotal: prasadam, otherTotal: other, totalExpense, totalDonations,
      net: round2(totalDonations - totalExpense), totalPlates: p,
      perPlate: p ? round2(totalExpense / p) : 0, perPlatePrasadam: p ? round2(prasadam / p) : 0
    };
  }

  const title = (subType, name, date) =>
    `Preaching – ${SUBTYPES[subType] || 'One Time'}${name ? ` (${name})` : ''}${date ? ' – ' + UI.fmtDate(date) : ''}`;

  /* ───────────── List ───────────── */
  async function renderList(el) {
    el.innerHTML = `
      <div class="page-head"><h1>Preaching</h1>
        <button class="btn btn-primary" id="new-event">＋ New Event</button></div>
      <div class="filters" role="search">
        <div class="seg" role="radiogroup" aria-label="Program type">
          ${[['ALL', 'All'], ['ONE_TIME', 'One Time'], ['SUNDAY_LOVE_FEAST', 'Sunday Love Feast']].map(([v, l]) =>
            `<button type="button" role="radio" data-type="${v}" aria-checked="${filters.type === v}">${l}</button>`).join('')}
        </div>
        <select id="f-month" aria-label="Month"><option value="">All months</option></select>
        <input id="f-q" type="search" placeholder="Search name, menu, notes…" value="${esc(filters.q)}" aria-label="Search">
      </div>
      <div id="event-list">${UI.spinner()}</div>`;
    el.querySelector('#new-event').onclick = newEvent;
    const events = await Api.call('listEvents');

    const months = [...new Set(events.map(e => (e.Date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
    const fm = el.querySelector('#f-month');
    fm.innerHTML += months.map(m => `<option value="${m}"${filters.month === m ? ' selected' : ''}>${UI.monthLabel(m)}</option>`).join('');

    const draw = () => {
      const q = filters.q.toLowerCase();
      const rows = events.filter(e =>
        (filters.type === 'ALL' || e.SubType === filters.type) &&
        (!filters.month || (e.Date || '').startsWith(filters.month)) &&
        (!q || [e.Title, e.Name, e.Menu, e.Notes].join(' ').toLowerCase().includes(q)));
      const list = el.querySelector('#event-list');
      if (!rows.length) {
        list.innerHTML = `<div class="empty-state"><p>${events.length ? 'No events match these filters.' : 'No preaching events yet.'}</p></div>`;
        return;
      }
      const tot = rows.reduce((a, e) => { a.spent += e.summary.totalExpense; a.don += e.summary.totalDonations; a.plates += e.summary.totalPlates; return a; }, { spent: 0, don: 0, plates: 0 });
      list.innerHTML = `
        <p class="muted small list-total">${rows.length} event${rows.length > 1 ? 's' : ''} · spent ${inr(tot.spent)} · donations ${inr(tot.don)} · ${tot.plates} plates</p>
        <div class="card-grid">${rows.map(e => {
          const s = e.summary;
          return `<a class="card event-card" href="#/event/${encodeURIComponent(e.EventID)}">
            <div class="mc-head"><h3>${esc(e.Name || SUBTYPES[e.SubType])}</h3>
              <span class="badge ${e.SubType === 'SUNDAY_LOVE_FEAST' ? 'badge-slf' : 'badge-one'}">${e.SubType === 'SUNDAY_LOVE_FEAST' ? 'SLF' : 'One Time'}</span></div>
            <p class="muted small">${UI.fmtDate(e.Date)}</p>
            <dl class="stats">
              <div><dt>Spent</dt><dd>${inr(s.totalExpense)}</dd></div>
              <div><dt>Donations</dt><dd>${inr(s.totalDonations)}</dd></div>
              <div><dt>Plates</dt><dd>${s.totalPlates}</dd></div>
              <div><dt>Per plate</dt><dd>${s.totalPlates ? inr(s.perPlate) : '—'}</dd></div>
            </dl>
          </a>`;
        }).join('')}</div>`;
    };

    el.querySelectorAll('.seg [data-type]').forEach(b => b.addEventListener('click', () => {
      filters.type = b.dataset.type;
      el.querySelectorAll('.seg [data-type]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      draw();
    }));
    fm.addEventListener('change', () => { filters.month = fm.value; draw(); });
    el.querySelector('#f-q').addEventListener('input', UI.debounce(e => { filters.q = e.target.value.trim(); draw(); }, 200));
    draw();
  }

  function eventForm(ev) {
    ev = ev || { SubType: 'SUNDAY_LOVE_FEAST', Date: UI.today() };
    return `
      <fieldset class="field"><legend>Type</legend><div class="radio-row">
        ${Object.entries(SUBTYPES).map(([k, l]) => `<label class="check"><input type="radio" name="SubType" value="${k}"${ev.SubType === k ? ' checked' : ''}> ${l}</label>`).join('')}
      </div></fieldset>
      <label class="field"><span>Name <span class="muted">(optional, e.g. Birthday Festival, Orientation)</span></span><input name="Name" value="${esc(ev.Name || '')}" maxlength="120"></label>
      <label class="field"><span>Date</span><input type="date" name="Date" required value="${esc(ev.Date || '')}"></label>
      <label class="field"><span>Notes</span><textarea name="Notes" rows="2">${esc(ev.Notes || '')}</textarea></label>
      <p class="form-error" hidden></p>`;
  }

  async function newEvent() {
    const created = await UI.modal({
      title: 'New preaching event', body: eventForm(null), submitLabel: 'Create event',
      onSubmit: v => {
        if (!v.Date) throw new Error('Date is required');
        return Api.call('createEvent', v);
      }
    });
    if (created) {
      UI.toast('Event created', 'success');
      App.go('#/event/' + encodeURIComponent(created.EventID));
    }
  }

  /* ───────────── Detail ───────────── */
  async function renderDetail(el, id) {
    el.innerHTML = UI.spinner();
    const data = await Api.call('getEvent', { EventID: id });
    const st = { event: data.event, donations: data.donations, expenses: data.expenses };
    const prasadam = () => st.expenses.filter(r => r.Section !== 'Other');
    const other = () => st.expenses.filter(r => r.Section === 'Other');

    el.innerHTML = `
      <div class="page-head">
        <div><a class="back" href="#/preaching">← Preaching</a>
          <h1 id="ev-title"></h1>
          <p class="muted small" id="ev-sub"></p></div>
        <div class="head-actions">
          <button class="btn btn-ghost btn-sm" id="edit-ev">Edit details</button>
          <button class="btn btn-ghost btn-sm btn-danger-text" id="del-ev">Delete event</button>
        </div>
      </div>
      <div class="mini-summary" id="mini"></div>
      <div class="detail-grid">
        <div class="detail-main">
          <section class="card">
            <div class="card-head"><h2>Menu &amp; plates</h2></div>
            <form id="details-form" class="details-form">
              <label class="field"><span>Menu</span><textarea name="Menu" rows="3" placeholder="One item per line">${esc(st.event.Menu || '')}</textarea></label>
              <div class="plates">
                <label class="field"><span>Student plates</span><input type="number" min="0" step="1" inputmode="numeric" name="StudentPlates" value="${num(st.event.StudentPlates)}"></label>
                <label class="field"><span>Inmate plates</span><input type="number" min="0" step="1" inputmode="numeric" name="InmatePlates" value="${num(st.event.InmatePlates)}"></label>
                <label class="field"><span>Other plates</span><input type="number" min="0" step="1" inputmode="numeric" name="OtherPlates" value="${num(st.event.OtherPlates)}"></label>
              </div>
              <button class="btn btn-primary btn-sm" type="submit" disabled>Save menu &amp; plates</button>
            </form>
          </section>
          <section class="card"><div class="card-head"><h2>Donations</h2></div><div id="don"></div></section>
          <section class="card"><div class="card-head"><h2>Prasadam expenses</h2></div><div id="pra"></div></section>
          <section class="card"><div class="card-head"><h2>Other expenses</h2></div><div id="oth"></div></section>
        </div>
        <aside class="detail-side"><div class="card summary" id="summary"></div></aside>
      </div>`;

    const header = () => {
      el.querySelector('#ev-title').textContent = st.event.Title || title(st.event.SubType, st.event.Name, st.event.Date);
      el.querySelector('#ev-sub').textContent = [SUBTYPES[st.event.SubType], st.event.Notes, 'Created by ' + (st.event.CreatedBy || '—')].filter(Boolean).join(' · ');
      el.querySelector('#ev-sub').title = UI.auditTitle(st.event);
    };
    header();

    // Plates/menu: live summary while typing, explicit save.
    const form = el.querySelector('#details-form');
    const saveBtn = form.querySelector('[type=submit]');
    const draft = () => Object.assign({}, st.event, {
      Menu: form.elements.namedItem('Menu').value,
      StudentPlates: form.elements.namedItem('StudentPlates').value,
      InmatePlates: form.elements.namedItem('InmatePlates').value,
      OtherPlates: form.elements.namedItem('OtherPlates').value
    });
    form.addEventListener('input', () => { saveBtn.disabled = false; refresh(); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const d = draft();
      try {
        st.event = await UI.busy(saveBtn, () => Api.call('updateEvent', {
          EventID: id, Menu: d.Menu, StudentPlates: d.StudentPlates, InmatePlates: d.InmatePlates, OtherPlates: d.OtherPlates
        }));
        saveBtn.disabled = true;
        UI.toast('Saved', 'success', 1500);
        refresh();
      } catch (err) { UI.fail(err); }
    });

    const uniq = (rows, key) => [...new Set(rows.map(r => r[key]).filter(Boolean))].sort();
    const refresh = () => renderSummary(el, draft(), st);

    new EditableTable(el.querySelector('#don'), {
      idKey: 'DonationID', rows: st.donations, addLabel: 'Add donation', emptyText: 'No donations recorded', totalKey: 'Amount',
      columns: [
        { key: 'Date', label: 'Date', type: 'date' },
        { key: 'DonorName', label: 'Donor', type: 'list', options: () => uniq(st.donations, 'DonorName') },
        { key: 'Amount', label: 'Amount', type: 'money', required: true },
        { key: 'Mode', label: 'Mode', type: 'select', options: () => ['Cash', 'UPI', 'Bank'] },
        { key: 'Remarks', label: 'Remarks', type: 'text' }
      ],
      newDefaults: last => ({ Date: (last && last.Date) || st.event.Date, Mode: (last && last.Mode) || 'Cash' }),
      describe: r => `donation of ${inr(r.Amount)}${r.DonorName ? ' from ' + r.DonorName : ''}`,
      onSave: (v, orig) => orig
        ? Api.call('updateDonation', Object.assign({ DonationID: orig.DonationID }, v))
        : Api.call('addDonation', Object.assign({ EventID: id }, v)),
      onDelete: r => Api.call('deleteDonation', { DonationID: r.DonationID }),
      onChange: rows => { st.donations = rows; refresh(); }
    });

    const expenseTable = (sel, section, rows, itemOpts) => new EditableTable(el.querySelector(sel), {
      idKey: 'ExpenseID', rows, addLabel: `Add ${section === 'Other' ? 'other expense' : 'prasadam item'}`,
      emptyText: 'No items yet', totalKey: 'Amount',
      columns: [
        { key: 'Item', label: 'Item', type: 'list', required: true, options: itemOpts },
        { key: 'Quantity', label: 'Qty', type: 'text', placeholder: 'e.g. 5' },
        { key: 'Unit', label: 'Unit', type: 'select', options: () => ['Kg', 'Ltr', 'Pcs'] },
        { key: 'Amount', label: 'Amount', type: 'money', required: true },
        { key: 'PaidBy', label: 'Paid by', type: 'list', options: () => uniq(st.expenses, 'PaidBy') },
        { key: 'Remarks', label: 'Remarks', type: 'text' }
      ],
      newDefaults: last => ({ PaidBy: last ? last.PaidBy : '' }),
      describe: r => `${r.Item || 'item'} (${inr(r.Amount)})`,
      onSave: (v, orig) => orig
        ? Api.call('updatePreachingExpense', Object.assign({ ExpenseID: orig.ExpenseID, Section: section }, v))
        : Api.call('addPreachingExpense', Object.assign({ EventID: id, Section: section }, v)),
      onDelete: r => Api.call('deletePreachingExpense', { ExpenseID: r.ExpenseID }),
      onChange: list => {
        st.expenses = st.expenses.filter(r => (section === 'Other' ? r.Section !== 'Other' : r.Section === 'Other')).concat(list);
        refresh();
      }
    });
    const items = () => App.cats('ITEM', 'PREACHING');
    expenseTable('#pra', 'Prasadam', prasadam(), items);
    expenseTable('#oth', 'Other', other(), items);
    refresh();

    el.querySelector('#edit-ev').onclick = async () => {
      const saved = await UI.modal({
        title: 'Edit event', body: eventForm(st.event),
        onSubmit: v => Api.call('updateEvent', Object.assign({ EventID: id }, v))
      });
      if (saved) { st.event = saved; header(); refresh(); UI.toast('Event updated', 'success'); }
    };
    el.querySelector('#del-ev').onclick = async () => {
      const n = st.donations.length + st.expenses.length;
      if (!(await UI.confirm(`Delete this event${n ? ` and its ${n} entries` : ''}? It will be hidden from the app (kept in the sheet as deleted).`, { okLabel: 'Delete event' }))) return;
      try {
        await Api.call('deleteEvent', { EventID: id });
        UI.toast('Event deleted', 'success');
        App.go('#/preaching');
      } catch (e) { UI.fail(e); }
    };
  }

  function renderSummary(el, ev, st) {
    const s = summarizeEvent(ev, st.donations, st.expenses);
    el.querySelector('#mini').innerHTML = `
      <span>Spent <strong>${inr(s.totalExpense)}</strong></span>
      <span>Donations <strong>${inr(s.totalDonations)}</strong></span>
      <span>Plates <strong>${s.totalPlates}</strong></span>
      <span>Per plate <strong>${s.totalPlates ? inr(s.perPlate) : '—'}</strong></span>`;
    el.querySelector('#summary').innerHTML = `
      <h2>Totals</h2>
      <dl class="kv">
        <div><dt>Prasadam total</dt><dd>${inr(s.prasadamTotal)}</dd></div>
        <div><dt>Other total</dt><dd>${inr(s.otherTotal)}</dd></div>
        <div class="kv-strong"><dt>Total expenses</dt><dd>${inr(s.totalExpense)}</dd></div>
        <div><dt>Total donations</dt><dd>${inr(s.totalDonations)}</dd></div>
        <div class="kv-strong"><dt>Net (donations − expenses)</dt><dd class="${s.net < 0 ? 'neg' : s.net > 0 ? 'pos' : ''}">${inr(s.net, { sign: true })}</dd></div>
      </dl>
      <dl class="kv">
        <div><dt>Student plates</dt><dd>${Math.round(num(ev.StudentPlates))}</dd></div>
        <div><dt>Inmate plates</dt><dd>${Math.round(num(ev.InmatePlates))}</dd></div>
        <div><dt>Other plates</dt><dd>${Math.round(num(ev.OtherPlates))}</dd></div>
        <div class="kv-strong"><dt>Total plates</dt><dd>${s.totalPlates}</dd></div>
        <div class="kv-strong"><dt>Per-plate cost</dt><dd>${s.totalPlates ? inr(s.perPlate) : '—'}</dd></div>
        <div><dt>Per-plate (prasadam only)</dt><dd>${s.totalPlates ? inr(s.perPlatePrasadam) : '—'}</dd></div>
      </dl>`;
  }

  return { renderList, renderDetail, summarizeEvent, SUBTYPES, title };
})();
