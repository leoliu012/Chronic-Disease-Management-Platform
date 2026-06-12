const fs = require('fs');
const path = require('path');
const { apiEnvPath, syncEnv } = require('./sync-env');

let lastRunAt = 0;

function runSync(reason) {
  const now = Date.now();
  if (now - lastRunAt < 300) return;
  lastRunAt = now;

  try {
    syncEnv();
    if (reason) {
      console.log(`Mini-program env synced after ${reason}.`);
    }
  } catch (error) {
    console.error(error.message);
  }
}

runSync('startup');

fs.watchFile(apiEnvPath, { interval: 1000 }, (current, previous) => {
  if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
    runSync(`${path.basename(apiEnvPath)} changed`);
  }
});

console.log(`Watching ${apiEnvPath}`);
console.log('Keep this process running while developing the mini-program.');
