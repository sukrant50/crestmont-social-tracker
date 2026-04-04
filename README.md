# Crestmont Social Tracker

This project runs once per day in GitHub Actions, scrapes follower data for the Crestmont Facebook and Instagram profiles, and appends the daily snapshot to a Google Sheet.

Tracked profiles:

- Facebook: `https://www.facebook.com/CrestmontHotelsandResorts`
- Instagram: `https://www.instagram.com/crestmont_hotels/`

## What gets written to Google Sheets

Each run appends one row per profile into the `followers_daily` tab with:

- `date_local`
- `timestamp_utc`
- `platform`
- `profile_id`
- `label`
- `profile_url`
- `followers`
- `following`
- `likes`
- `posts`

The script automatically creates the tab and header row if they do not exist.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   npx playwright install --with-deps chromium
   ```

2. Copy `.env.example` to `.env` and fill in:

   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SHEET_TAB` (optional, defaults to `followers_daily`)
   - `GOOGLE_SERVICE_ACCOUNT_JSON`
   - `SHEET_TIMEZONE` (optional, defaults to `Asia/Kolkata`)
   - `DRY_RUN` (optional, set `true` to skip Google Sheets writes)

3. Run:

   ```bash
   npm run start
   ```

For a scrape-only test without writing to Google Sheets:

```bash
npm run dry-run
```

## GitHub Actions secrets

Add these repository secrets:

- `GOOGLE_SHEET_ID`
- `GOOGLE_SHEET_TAB`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

Your Google Sheet must be shared with the service account email inside the JSON credentials.

## Recommended sheet formulas

If you want a growth column inside Google Sheets, add a formula like this in a new column:

```text
=IF(COUNTIFS($C:$C,C2,$E:$E,E2)=1,"",G2-LOOKUP(2,1/(($C$2:C1=C2)*($E$2:E1=E2)), $G$2:G1))
```

That calculates follower growth versus the previous row for the same platform and profile label.

## Notes

- Instagram and Facebook markup can change over time, so the scraper uses both meta descriptions and rendered page text as fallbacks.
- The GitHub Actions schedule is set to run daily at `02:30 UTC`, which is `08:00 IST`.
