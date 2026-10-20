# Ritudvipa BSC Finance

Free web app for BSC monthly accounts and preaching program expenses.
Frontend: static HTML/CSS/JS on GitHub Pages. Backend: Google Apps Script bound to a Google Sheet.

## 1. Backend (Google Apps Script)

1. Create a Google Sheet named **Ritudvipa BSC Finance DB**.
2. In the sheet: **Extensions → Apps Script**. Replace `Code.gs` with [backend/Code.gs](backend/Code.gs).
   Optionally use **Project Settings → Show "appsscript.json"** and paste [backend/appsscript.json](backend/appsscript.json) (sets timezone Asia/Kolkata).
3. At the top of `Code.gs`, set `SETUP_ADMIN_NAME` and `SETUP_ADMIN_PIN` (4–8 digits).
4. Select `setup` in the function dropdown and click **Run**, then approve the permissions.
   This creates all tabs, seeds the Categories tab and creates the first ADMIN.
5. **Deploy → New deployment → Web app**, Execute as **Me**, Who has access **Anyone** → Deploy. Copy the `/exec` URL.
6. (Optional, once) Run `importLegacy` from the editor to import Aug, Sep and Oct 2026 from the old sheets.
   Check the **ImportLog** tab: it lists every imported and skipped row, with the reason for each. You can run it again safely,
   because it first removes rows tagged `Source = LEGACY`. A month you already created in the app is never overwritten.

After you change `Code.gs`, use **Deploy → Manage deployments → Edit → New version**. This keeps the same URL.

## 2. Frontend (GitHub Pages)

1. Put the web app URL in [js/config.js](js/config.js) → `API_URL`.
2. Push this folder to a GitHub repo and turn on **Settings → Pages** (deploy from the branch root).
   Do **not** put `backend/` secrets anywhere. The PIN in `Code.gs` is only used by `setup()`. Change it in Settings afterwards.

## Calculation rules

- **Each month is a separate account.** There is no opening balance and nothing carries over between months; every total is for that month only.
- **Profit/Loss** = Total income − Total expenditure (for that month).
- **BSC Loss** = expenditure not met by regular income. Regular income excludes "Last Month Remaining" and
  "HELP (BSC Loss Coverage)". The month shows the loss, the HELP coverage received and the remaining gap.
- "Last Month Remaining" rows are counted in that month's Total income, as in the original sheets. The dashboard leaves them out of
  "BSC total income" so the same money isn't counted twice across several months.
  The legacy import does this automatically.
- An expense is "paid personally" when **Expense Beared By** is filled in and isn't Ritudwip BSC.
- Preaching: Net = Donations − Expenses. Per-plate cost = Total expenses ÷ (Student + Inmate + Other plates).

## Notes

- Sessions last 6 hours (CacheService). Five wrong PINs lock that name out for 15 minutes.
- Deletes are soft: rows get `Deleted = TRUE` and stay in the sheet.
- Offline: pages you have opened before are shown from saved data (read-only). `sw.js` caches the app files.
- Excel export uses `xlsx-js-style` (a SheetJS build that supports bold, fills and borders) and runs entirely in the browser.

## Speed, caching and Refresh

- **At login** the app downloads all data from the sheet (lists, dashboard, every month and event) and saves it on the phone.
  After that, every page opens instantly from the saved copy.
- **Background updates:** when a page opens, the saved copy shows first. If it is older than 15 seconds, the app checks the sheet
  in the background and quietly updates the page if anything changed. It does not interrupt you while you are editing; instead an
  orange dot appears on ↻.
- **Your own changes** always show up straight away.
- **↻ Refresh** (top bar) re-downloads everything from the sheet. Use it to see changes made by other users, or if data looks out of date.
- **Server cache:** Apps Script keeps read results for up to 5 minutes, and any save in the app clears it. Edits typed directly into the
  Google Sheet appear after Refresh, or within 5 minutes.
- **Install on a phone:** Android/Chrome shows an **Install** button in the top bar. On iPhone, use Safari → Share → *Add to Home Screen*.
- Logos: `assets/header-logo.png` and `assets/main-logo.png` are resized copies of `headerlogo.jpeg` and `mainlogo.jpeg`
  (the originals are not loaded by the app).
