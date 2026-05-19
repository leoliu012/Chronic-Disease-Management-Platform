import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Web quality script registrar.
 *
 * apps/web/package.json uses "type": "module", so this file must be ESM.
 * Keep this script dependency-free and non-destructive:
 * - Preserve all existing package.json fields and scripts.
 * - Only add/update quality-related scripts.
 * - Do not overwrite build/dev/start scripts.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.resolve(__dirname, '..', 'package.json');

function readPackageJson() {
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found at ${packageJsonPath}`);
  }

  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function writePackageJson(pkg) {
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function main() {
  const pkg = readPackageJson();
  pkg.scripts = pkg.scripts || {};

  const additions = {
    typecheck: pkg.scripts.typecheck || 'tsc -b --noEmit',
    'quality:check': pkg.scripts['quality:check'] || 'npm run typecheck && npm run build',
    'quality:register': 'node scripts/register-quality-scripts.js',
  };

  Object.assign(pkg.scripts, additions);
  writePackageJson(pkg);

  console.log('Updated apps/web/package.json scripts:');
  for (const [name, command] of Object.entries(additions)) {
    console.log(`- ${name}: ${command}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
