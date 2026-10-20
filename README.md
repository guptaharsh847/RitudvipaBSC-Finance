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

- **Profit/Loss** = Total income − Total expenditure. **Current balance** = Opening balance + Profit/Loss.
- **BSC Loss** = expenditure not met by regular income. Regular income excludes "Last Month Remaining" and
  "HELP (BSC Loss Coverage)". The month shows the loss, the HELP coverage received and the remaining gap.
- If "Last Month Remaining" is recorded as an income row, set the Opening balance to 0 so it isn't counted twice.
  The legacy import does this automatically.
- An expense is "paid personally" when **Expense Beared By** is filled in and isn't Ritudwip BSC.
- Preaching: Net = Donations − Expenses. Per-plate cost = Total expenses ÷ (Student + Inmate + Other plates).

## Notes

- Sessions last 6 hours (CacheService). Five wrong PINs lock that name out for 15 minutes.
- Deletes are soft: rows get `Deleted = TRUE` and stay in the sheet.
- Offline: pages you have opened before are shown from saved data (read-only). `sw.js` caches the app files.
- Excel export uses `xlsx-js-style` (a SheetJS build that supports bold, fills and borders) and runs entirely in the browser.
