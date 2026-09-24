'use strict';

const fs = require('fs');
const path = require('path');

// Ordered so the common commands surface first in the panel.
const SCRIPT_ORDER = ['dev', 'start', 'serve', 'build', 'test', 'lint', 'preview', 'format'];

function detectPackageManager(cwd) {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'bun.lockb'))) return 'bun';
  return 'npm';
}

/**
 * The runnable scripts for the open folder.
 *
 * Only package.json is read here. Running one is handed to the terminal
 * manager, so there is a single place where processes start and a single place
 * to stop them.
 */
function list(cwd) {
  if (!cwd) return { scripts: [], packageManager: 'npm' };

  const packageJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return { scripts: [], packageManager: 'npm', hasPackageJson: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  } catch (error) {
    return { scripts: [], packageManager: 'npm', hasPackageJson: true, error: `package.json is not valid JSON: ${error.message}` };
  }

  const packageManager = detectPackageManager(cwd);
  const entries = Object.entries(parsed.scripts || {});

  const scripts = entries.map(([name, command]) => ({
    name,
    command: String(command),
    // `npm run start` works, but `npm start` is what people expect to see.
    invocation: name === 'start' && packageManager === 'npm'
      ? 'npm start'
      : `${packageManager} run ${name}`
  }));

  scripts.sort((a, b) => {
    const rankA = SCRIPT_ORDER.indexOf(a.name);
    const rankB = SCRIPT_ORDER.indexOf(b.name);
    if (rankA !== -1 && rankB !== -1) return rankA - rankB;
    if (rankA !== -1) return -1;
    if (rankB !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    scripts,
    packageManager,
    hasPackageJson: true,
    projectName: parsed.name || path.basename(cwd)
  };
}

module.exports = { list, detectPackageManager };
