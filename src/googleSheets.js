const { google } = require("googleapis");

const HEADER_ROW = ["Date", "Instagram Followers", "Facebook Followers"];

function formatDateInTimezone(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getServiceAccountCredentials() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!rawJson) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON environment variable.");
  }

  const credentials = JSON.parse(rawJson);

  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  return credentials;
}

async function getSheetsClient() {
  const credentials = getServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({
    version: "v4",
    auth: await auth.getClient()
  });
}

async function ensureSheetExists(sheets, spreadsheetId, tabName) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });

  const hasSheet = (spreadsheet.data.sheets || []).some(
    (sheet) => sheet.properties && sheet.properties.title === tabName
  );

  if (hasSheet) {
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabName } } }]
    }
  });
}

async function ensureHeaderRow(sheets, spreadsheetId, tabName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!1:1`
  });

  const header = response.data.values && response.data.values[0];

  if (header && header.length) {
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!1:1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER_ROW] }
  });
}

function buildRow(results, timezone) {
  const date = formatDateInTimezone(new Date(results[0].scrapedAtUtc), timezone);

  const instagram = results.find((r) => r.platform === "instagram");
  const facebook = results.find((r) => r.platform === "facebook");

  return [
    date,
    instagram ? instagram.followers || "" : "",
    facebook ? facebook.followers || "" : ""
  ];
}

async function appendSnapshotRows(results) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const tabName = process.env.GOOGLE_SHEET_TAB || "followers_daily";
  const timezone = process.env.SHEET_TIMEZONE || "Asia/Kolkata";

  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEET_ID environment variable.");
  }

  const sheets = await getSheetsClient();

  await ensureSheetExists(sheets, spreadsheetId, tabName);
  await ensureHeaderRow(sheets, spreadsheetId, tabName);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:C`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [buildRow(results, timezone)] }
  });
}

module.exports = { appendSnapshotRows };
