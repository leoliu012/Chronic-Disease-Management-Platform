const fs = require('fs');
const path = require('path');

const miniRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(miniRoot, '..', '..');
const apiEnvPath = path.join(repoRoot, 'apps', 'api', '.env');
const outputPath = path.join(miniRoot, 'env.js');

function parseDotEnv(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function syncEnv() {
  if (!fs.existsSync(apiEnvPath)) {
    throw new Error(`Missing API env file: ${apiEnvPath}`);
  }

  const env = parseDotEnv(fs.readFileSync(apiEnvPath, 'utf8'));
  const apiBaseUrl = env.PATIENT_ENGAGEMENT_API_BASE_URL || env.API_BASE_URL;

  if (!apiBaseUrl) {
    throw new Error('PATIENT_ENGAGEMENT_API_BASE_URL or API_BASE_URL is required in apps/api/.env');
  }

  const normalizedApiBaseUrl = apiBaseUrl.replace(/\/+$/, '');

  fs.writeFileSync(
    outputPath,
    `module.exports = {\n  apiBaseUrl: ${JSON.stringify(normalizedApiBaseUrl)}\n};\n`,
  );

  console.log(`Wrote ${path.relative(repoRoot, outputPath)} -> ${normalizedApiBaseUrl}`);
  return { apiBaseUrl: normalizedApiBaseUrl, outputPath, apiEnvPath };
}

if (require.main === module) {
  syncEnv();
}

module.exports = {
  apiEnvPath,
  outputPath,
  syncEnv,
};
