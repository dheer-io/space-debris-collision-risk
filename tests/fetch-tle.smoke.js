// Smoke test for backend/fetchTleData.js — actually calls CelesTrak for
// every configured group and reports which ones succeeded, without writing
// any files. Run it directly:
//
//   node tests/fetch-tle.smoke.js
//
// Use this to sanity-check a change to GROUPS (new group name, etc.) before
// relying on the scheduled GitHub Actions workflow to catch a typo.

import { GROUPS, fetchGroup } from "../backend/fetchTleData.js";

async function main() {
  let totalObjects = 0;
  let failureCount = 0;

  for (const group of GROUPS) {
    try {
      const objects = await fetchGroup(group);
      totalObjects += objects.length;
      console.log(`PASS  ${group.name.padEnd(20)} ${objects.length} objects`);
    } catch (error) {
      failureCount += 1;
      console.log(`FAIL  ${group.name.padEnd(20)} ${error.message}`);
    }
  }

  console.log(`\n${GROUPS.length - failureCount}/${GROUPS.length} groups OK, ${totalObjects} objects total`);

  if (totalObjects === 0) {
    console.error("No objects fetched from any group — treating this as a failed run.");
    process.exitCode = 1;
  }
}

main();
