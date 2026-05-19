const fs = require('fs');
const path = require('path');

/**
 * CommonJS compatibility registrar.
 *
 * Prefer `node scripts/register-quality-scripts.js` in this project because
 * apps/web/package.json has "type": "module". This .cjs file is included for
 * developers who explicitly want a CommonJS entry point.
 */

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
