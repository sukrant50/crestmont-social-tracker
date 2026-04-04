require("dotenv").config();

const profiles = require("./profiles");
const { scrapeProfiles } = require("./scrapers");
const { appendSnapshotRows } = require("./googleSheets");

async function main() {
  const results = await scrapeProfiles(profiles);
  const isDryRun = String(process.env.DRY_RUN).toLowerCase() === "true";

  if (!isDryRun) {
    await appendSnapshotRows(results);
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        dryRun: isDryRun,
        trackedProfiles: results.length,
        results
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        error: error.message
      },
      null,
      2
    )
  );
  process.exit(1);
});
