// Export: pick BSC months / preaching events → one .xlsx (one worksheet each), built in the browser.
// Uses xlsx-js-style (SheetJS build with cell-style support) loaded from CDN as global XLSX.
const Exporter = (() => {
  const { esc, inr } = UI;
  const MONEY_FMT = '"₹"#,##0;[Red]-"₹"#,##0';
  const DATE_FMT = 'd-mmm-yyyy';

  const border = { style: 'thin', color: { rgb: 'D9C3B0' } };
  const S = {
    title: { font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '8C1D40' } }, alignment: { horizontal: 'left', vertical: 'center' } },
    sub: { font: { bold: true, sz: 12, color: { rgb: '8C1D40' } } },
    section: { font: { bold: true, color: { rgb: '5A1028' } }, fill: { fgColor: { rgb: 'FBD9B5' } }, alignment: { horizontal: 'center' } },
    head: { font: { bold: true }, fill: { fgColor: { rgb: 'FDF0E2' } }, border: { bottom: border, top: border, left: border, right: border }, alignment: { horizontal: 'center', wrapText: true } },
    cell: { border: { bottom: border, left: border, right: border }, alignment: { vertical: 'top', wrapText: true } },
    total: { font: { bold: true }, fill: { fgColor: { rgb: 'FFF2CC' } }, border: { top: { style: 'medium', color: { rgb: '8C1D40' } }, bottom: border, left: border, right: border } },
    label: { border: { bottom: border, left: border, right: border } },
    labelBold: { font: { bold: true }, fill: { fgColor: { rgb: 'FFF2CC' } }, border: { bottom: border, left: border, right: border, top: border } },
    loss: { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: 'B3261E' } }, alignment: { horizontal: 'center' } },
    note: { font: { italic: true, color: { rgb: '7A6A60' } } }
  };

  /* ───────────── Worksheet builder ───────────── */
  class WS {
    constructor() { this.ws = {}; this.maxR = 0; this.maxC = 0; this.merges = []; }
    put(r, c, v, style, extra = {}) {
      let cell;
      if (v && typeof v === 'object' && 'f' in v) cell = { t: 'n', f: v.f, v: v.v || 0 };
      else if (typeof v === 'number') cell = { t: 'n', v };
      else cell = { t: 's', v: v === null || v === undefined ? '' : String(v) };
      const s = Object.assign({}, style || {});
      if (extra.money) { cell.z = MONEY_FMT; s.numFmt = MONEY_FMT; s.alignment = Object.assign({}, s.alignment, { horizontal: 'right' }); }
      if (extra.date) { cell.z = DATE_FMT; s.numFmt = DATE_FMT; s.alignment = Object.assign({}, s.alignment, { horizontal: 'left' }); }
      if (extra.num) s.alignment = Object.assign({}, s.alignment, { horizontal: 'right' });
      if (Object.keys(s).length) cell.s = s;
      this.ws[XLSX.utils.encode_cell({ r, c })] = cell;
      this.maxR = Math.max(this.maxR, r); this.maxC = Math.max(this.maxC, c);
      return cell;
    }
    date(r, c, ymd, style) {
      if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return this.put(r, c, ymd || '', style);
      const [y, m, d] = ymd.split('-').map(Number);
      return this.put(r, c, Date.UTC(y, m - 1, d) / 864e5 + 25569, style, { date: true });
    }
    merge(r1, c1, r2, c2, v, style) {
      this.put(r1, c1, v, style);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) this.put(r, c, '', style);
      this.merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
    }
    build(widths) {
      this.ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: this.maxR, c: this.maxC } });
      this.ws['!merges'] = this.merges;
      this.ws['!cols'] = widths.map(w => ({ wch: w }));
      return this.ws;
    }
  }
  const A = (r, c) => XLSX.utils.encode_cell({ r, c });
  const colSum = (c, r1, r2, v) => (r2 >= r1 ? { f: `SUM(${A(r1, c)}:${A(r2, c)})`, v } : 0);

  /* ───────────── BSC month sheet: income A–E | expenses F–K | summary M–N ───────────── */
  function monthSheet(d) {
    const s = BscMonths.summarizeMonth(d.month, d.income, d.expenses);
    const label = UI.monthLabel(d.month.Month);
    const w = new WS();
    w.merge(0, 0, 0, 13, d.month.Title || `BSC Accounts – ${label}`, S.title);
    w.merge(1, 0, 1, 4, 'INCOME', S.section);
    w.merge(1, 5, 1, 10, 'EXPENDITURE', S.section);
    ['Date', 'Person', 'Purpose', 'Amount', 'Remarks'].forEach((h, i) => w.put(2, i, h, S.head));
    ['Date', 'Mediator (Purchasing Person)', 'Expense Beared By', 'Purpose', 'Amount', 'Remarks'].forEach((h, i) => w.put(2, 5 + i, h, S.head));
    const first = 3;
    d.income.forEach((r, i) => {
      const row = first + i;
      w.date(row, 0, r.Date, S.cell);
      w.put(row, 1, r.Person, S.cell); w.put(row, 2, r.Purpose, S.cell);
      w.put(row, 3, UI.num(r.Amount), S.cell, { money: true }); w.put(row, 4, r.Remarks, S.cell);
    });
    d.expenses.forEach((r, i) => {
      const row = first + i;
      w.date(row, 5, r.Date, S.cell);
      w.put(row, 6, r.Mediator, S.cell); w.put(row, 7, r.ExpenseBearedBy, S.cell); w.put(row, 8, r.Purpose, S.cell);
      w.put(row, 9, UI.num(r.Amount), S.cell, { money: true }); w.put(row, 10, r.Remarks, S.cell);
    });
    const rows = Math.max(d.income.length, d.expenses.length, 1);
    const tr = first + rows;
    w.merge(tr, 0, tr, 2, 'Total Income', S.total);
    w.put(tr, 3, colSum(3, first, first + d.income.length - 1, s.totalIncome), S.total, { money: true });
    w.put(tr, 4, '', S.total);
    w.merge(tr, 5, tr, 8, 'Total Expenditure', S.total);
    w.put(tr, 9, colSum(9, first, first + d.expenses.length - 1, s.totalExpense), S.total, { money: true });
    w.put(tr, 10, '', S.total);
    if (d.month.Notes) w.put(tr + 2, 0, 'Notes: ' + d.month.Notes, S.note);

    // Summary block (M–N).
    let r = 1;
    const kv = (k, v, bold) => { w.put(r, 12, k, bold ? S.labelBold : S.label); w.put(r, 13, v, bold ? S.labelBold : S.label, { money: true }); r++; };
    w.merge(r, 12, r, 13, 'Income-Expenditure Summary', S.section); r++;
    const incRow = r; kv('Total Income', { f: A(tr, 3), v: s.totalIncome });
    const expRow = r; kv('Total Expenditure', { f: A(tr, 9), v: s.totalExpense });
    kv('Profit / Loss', { f: `${A(incRow, 13)}-${A(expRow, 13)}`, v: s.profitLoss }, true);
    r++;
    const block = (title, obj) => {
      const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
      if (!entries.length) return;
      w.put(r, 12, title, S.head); w.put(r, 13, 'Amount', S.head); r++;
      entries.forEach(([k, v]) => kv(k, v));
      r++;
    };
    block('Income by Purpose', s.incomeByPurpose);
    block('Expenditure by Purpose', s.expenseByPurpose);
    if (s.isLoss) {
      w.merge(r, 12, r, 13, BscMonths.lossTitle(d.month.Month), S.loss); r++;
      kv('Loss (expenses not met by regular income)', s.loss);
      kv(window.APP_CONFIG.PURPOSE_COVERAGE + ' received', s.coverage);
      kv('Remaining gap', s.gap, true);
      r++;
    }
    if (s.personal.length) {
      w.put(r, 12, 'Paid personally by devotee', S.head); w.put(r, 13, 'Amount', S.head); r++;
      s.personal.forEach(p => kv(`${p.bearer} (${p.count})`, p.total));
    }
    const ws = w.build([12, 18, 26, 13, 24, 12, 20, 18, 22, 13, 24, 3, 40, 15]);
    ws['!rows'] = [{ hpt: 24 }];
    return ws;
  }

  /* ───────────── Preaching sheet: menu A | Prasadam C–H | summary J–K | Other M–R | donations below ───────────── */
  function eventSheet(d) {
    const ev = d.event;
    const s = Preaching.summarizeEvent(ev, d.donations, d.expenses);
    const pra = d.expenses.filter(x => x.Section !== 'Other');
    const oth = d.expenses.filter(x => x.Section === 'Other');
    const w = new WS();
    w.merge(0, 0, 0, 17, ev.Title || Preaching.title(ev.SubType, ev.Name, ev.Date), S.title);
    w.put(1, 0, 'MENU', S.section);
    w.merge(1, 2, 1, 7, 'PRASADAM (GROCERY)', S.section);
    w.merge(1, 9, 1, 10, 'SUMMARY', S.section);
    w.merge(1, 12, 1, 17, 'OTHER EXPENSES', S.section);
    const head = ['Item', 'Quantity', 'Unit', 'Amount', 'Paid By', 'Remarks'];
    head.forEach((h, i) => { w.put(2, 2 + i, h, S.head); w.put(2, 12 + i, h, S.head); });

    const menu = String(ev.Menu || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
    menu.forEach((m, i) => w.put(2 + i, 0, m, S.cell));

    const first = 3;
    const itemRows = (list, c0) => list.forEach((x, i) => {
      const row = first + i;
      w.put(row, c0, x.Item, S.cell);
      const q = x.Quantity;
      w.put(row, c0 + 1, q === '' || q === null || q === undefined ? '' : (isFinite(Number(q)) ? Number(q) : String(q)), S.cell, { num: true });
      w.put(row, c0 + 2, x.Unit, S.cell);
      w.put(row, c0 + 3, UI.num(x.Amount), S.cell, { money: true });
      w.put(row, c0 + 4, x.PaidBy, S.cell);
      w.put(row, c0 + 5, x.Remarks, S.cell);
    });
    itemRows(pra, 2);
    itemRows(oth, 12);
    const tr = first + Math.max(pra.length, oth.length, 1);
    w.merge(tr, 2, tr, 4, 'Prasadam Total', S.total);
    w.put(tr, 5, colSum(5, first, first + pra.length - 1, s.prasadamTotal), S.total, { money: true });
    w.put(tr, 6, '', S.total); w.put(tr, 7, '', S.total);
    w.merge(tr, 12, tr, 14, 'Other Total', S.total);
    w.put(tr, 15, colSum(15, first, first + oth.length - 1, s.otherTotal), S.total, { money: true });
    w.put(tr, 16, '', S.total); w.put(tr, 17, '', S.total);

    // Summary J–K.
    let r = 2;
    const kv = (k, v, opts = {}, bold) => { w.put(r, 9, k, bold ? S.labelBold : S.label); w.put(r, 10, v, bold ? S.labelBold : S.label, opts); return r++; };
    w.put(r, 9, 'Program Date', S.label); w.date(r, 10, ev.Date, S.label); r++;
    kv('Type', Preaching.SUBTYPES[ev.SubType] || ev.SubType);
    if (ev.Name) kv('Name', ev.Name);
    const sp = kv('Student Plates Count', Math.round(UI.num(ev.StudentPlates)), { num: true });
    kv('Inmates Plates', Math.round(UI.num(ev.InmatePlates)), { num: true });
    const op = kv('Other Plates', Math.round(UI.num(ev.OtherPlates)), { num: true });
    const tp = kv('Total Plates', { f: `SUM(${A(sp, 10)}:${A(op, 10)})`, v: s.totalPlates }, { num: true }, true);
    r++;
    const pr = kv('Prasadam Total', { f: A(tr, 5), v: s.prasadamTotal }, { money: true });
    const or = kv('Other Total', { f: A(tr, 15), v: s.otherTotal }, { money: true });
    const te = kv('Total Expenses', { f: `${A(pr, 10)}+${A(or, 10)}`, v: s.totalExpense }, { money: true }, true);

    // Donations (below the item tables, columns C–G).
    let dr = tr + 2;
    w.merge(dr, 2, dr, 7, 'DONATIONS', S.section); dr++;
    ['Date', 'Donor', 'Mode', 'Amount', 'Remarks'].forEach((h, i) => w.put(dr, 2 + i, h, S.head));
    w.put(dr, 7, '', S.head);
    dr++;
    const dFirst = dr;
    d.donations.forEach(x => {
      w.date(dr, 2, x.Date, S.cell); w.put(dr, 3, x.DonorName, S.cell); w.put(dr, 4, x.Mode, S.cell);
      w.put(dr, 5, UI.num(x.Amount), S.cell, { money: true }); w.put(dr, 6, x.Remarks, S.cell); w.put(dr, 7, '', S.cell);
      dr++;
    });
    if (!d.donations.length) { w.merge(dr, 2, dr, 7, 'No donations recorded', S.note); dr++; }
    w.merge(dr, 2, dr, 4, 'Total Donations', S.total);
    w.put(dr, 5, colSum(5, dFirst, dr - 1, s.totalDonations), S.total, { money: true });
    w.put(dr, 6, '', S.total); w.put(dr, 7, '', S.total);
    const donTotalRow = dr;

    const td = kv('Total Donations', { f: A(donTotalRow, 5), v: s.totalDonations }, { money: true });
    kv('Net (Donations − Expenses)', { f: `${A(td, 10)}-${A(te, 10)}`, v: s.net }, { money: true }, true);
    kv('Per-plate Cost', { f: `IF(${A(tp, 10)}>0,${A(te, 10)}/${A(tp, 10)},0)`, v: s.perPlate }, { money: true }, true);
    if (ev.Notes) w.put(dr + 2, 0, 'Notes: ' + ev.Notes, S.note);

    const ws = w.build([28, 2, 20, 10, 7, 13, 14, 20, 2, 26, 15, 2, 20, 10, 7, 13, 14, 22]);
    ws['!rows'] = [{ hpt: 24 }];
    return ws;
  }

  function sheetName(base, used) {
    let n = String(base).replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
    let i = 2;
    const orig = n;
    while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = orig.slice(0, 31 - suf.length) + suf; }
    used.add(n.toLowerCase());
    return n;
  }

  function eventSheetBase(ev) {
    const [y, m, d] = (ev.Date || '').split('-').map(Number);
    const date = ev.Date ? `${d} ${UI.MONTHS[m - 1]} ${String(y).slice(2)}` : '';
    return `${date} ${ev.Name || (ev.SubType === 'SUNDAY_LOVE_FEAST' ? 'SLF' : 'One Time')}`;
  }

  function buildWorkbook(data) {
    const wb = XLSX.utils.book_new();
    const used = new Set();
    data.months.forEach(d => XLSX.utils.book_append_sheet(wb, monthSheet(d), sheetName('BSC ' + UI.monthLabel(d.month.Month), used)));
    data.events.forEach(d => XLSX.utils.book_append_sheet(wb, eventSheet(d), sheetName(eventSheetBase(d.event), used)));
    wb.Props = { Title: window.APP_CONFIG.APP_NAME + ' export', Author: (App.user && App.user.Name) || '', CreatedDate: new Date() };
    return wb;
  }

  async function download(payload, btn, label) {
    if (typeof XLSX === 'undefined') return UI.toast('Excel library did not load — check your connection and reload.', 'error');
    try {
      const data = await UI.busy(btn, () => Api.call('getExportData', payload));
      if (!data.months.length && !data.events.length) return UI.toast('Nothing to export', 'error');
      const wb = buildWorkbook(data);
      const name = `Ritudvipa-BSC-Finance_${label}_${UI.today()}.xlsx`;
      XLSX.writeFile(wb, name, { compression: true });
      UI.toast(`Downloaded ${data.months.length + data.events.length} sheet(s)`, 'success');
    } catch (e) { UI.fail(e); }
  }

  /* ───────────── Screen ───────────── */
  async function render(el) {
    el.innerHTML = `<div class="page-head"><h1>Export to Excel</h1></div>${UI.spinner()}`;
    const [months, events] = await Promise.all([Api.call('listMonths'), Api.call('listEvents')]);
    const now = new Date();
    const from3 = UI.isoDate(new Date(now.getFullYear(), now.getMonth() - 2, 1));
    el.innerHTML = `
      <div class="page-head"><h1>Export to Excel</h1></div>
      <p class="muted">Tick months and/or events to get <strong>one .xlsx file</strong> with one worksheet each, laid out like the original sheets.</p>
      <div class="export-grid">
        <section class="card">
          <div class="card-head"><h2>BSC months</h2><label class="check small"><input type="checkbox" data-all="m"> Select all</label></div>
          <ul class="pick-list">${months.length ? months.map(m => `
            <li><label class="check"><input type="checkbox" data-m="${esc(m.MonthID)}">
              <span class="grow">${esc(UI.monthLabel(m.Month))}${m.summary.isLoss ? ' <span class="badge badge-loss">loss</span>' : ''}</span>
              <span class="muted small">${inr(m.summary.totalExpense)}</span></label></li>`).join('') : '<li class="muted">No months</li>'}</ul>
        </section>
        <section class="card">
          <div class="card-head"><h2>Preaching events</h2><label class="check small"><input type="checkbox" data-all="e"> Select all</label></div>
          <ul class="pick-list">${events.length ? events.map(e => `
            <li><label class="check"><input type="checkbox" data-e="${esc(e.EventID)}">
              <span class="grow">${esc(UI.fmtDate(e.Date))} · ${esc(e.Name || Preaching.SUBTYPES[e.SubType])}</span>
              <span class="muted small">${inr(e.summary.totalExpense)}</span></label></li>`).join('') : '<li class="muted">No events</li>'}</ul>
        </section>
      </div>
      <div class="sticky-actions">
        <span id="sel-count" class="muted">0 selected</span>
        <button class="btn btn-primary" id="dl-sel" disabled>⇩ Download selected (.xlsx)</button>
      </div>
      <section class="card">
        <div class="card-head"><h2>Export all in date range</h2></div>
        <form class="filters" id="range-export">
          <label class="field-inline"><span>From</span><input type="date" name="from" value="${from3}" required></label>
          <label class="field-inline"><span>To</span><input type="date" name="to" value="${UI.today()}" required></label>
          <button class="btn btn-primary btn-sm" type="submit">⇩ Export all in range</button>
        </form>
        <p class="muted small">Includes every BSC month whose month falls in the range and every preaching event dated in the range.</p>
      </section>`;

    const boxes = sel => [...el.querySelectorAll(sel)];
    const update = () => {
      const n = boxes('[data-m]:checked').length + boxes('[data-e]:checked').length;
      el.querySelector('#sel-count').textContent = `${n} selected`;
      el.querySelector('#dl-sel').disabled = !n;
    };
    el.addEventListener('change', e => {
      const all = e.target.dataset.all;
      if (all) boxes(`[data-${all}]`).forEach(b => { b.checked = e.target.checked; });
      update();
    });
    el.querySelector('#dl-sel').addEventListener('click', e => download({
      monthIds: boxes('[data-m]:checked').map(b => b.dataset.m),
      eventIds: boxes('[data-e]:checked').map(b => b.dataset.e)
    }, e.currentTarget, 'selection'));
    el.querySelector('#range-export').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.currentTarget;
      const from = f.elements.namedItem('from').value, to = f.elements.namedItem('to').value;
      if (from > to) return UI.toast('“From” must be before “To”', 'error');
      download({ from, to }, f.querySelector('[type=submit]'), `${from}_to_${to}`);
    });
  }

  return { render, buildWorkbook };
})();
