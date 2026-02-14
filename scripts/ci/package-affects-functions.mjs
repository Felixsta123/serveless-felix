import { execSync } from 'node:child_process';
import fs from 'node:fs';

const base = process.env.BASE_SHA;
const head = process.env.HEAD_SHA;

if (!base || !head) {
  process.stdout.write('true');
  process.exit(0);
}

const readJsonAt = (rev, file) => {
  try {
    return JSON.parse(execSync(`git show ${rev}:${file}`, { encoding: 'utf8' }));
  } catch {
    return null;
  }
};

const before = readJsonAt(base, 'package.json');
const after =
  readJsonAt(head, 'package.json') ??
  JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (!before || !after) {
  process.stdout.write('true');
  process.exit(0);
}

const pick = (pkg) => ({
  dependencies: pkg.dependencies ?? {},
  devDependencies: pkg.devDependencies ?? {},
  optionalDependencies: pkg.optionalDependencies ?? {},
  peerDependencies: pkg.peerDependencies ?? {},
  engines: pkg.engines ?? {},
  type: pkg.type ?? null,
  main: pkg.main ?? null,
  buildScript: pkg.scripts?.build ?? null,
  gcpBuildScript: pkg.scripts?.['gcp-build'] ?? null,
});

process.stdout.write(
  JSON.stringify(pick(before)) === JSON.stringify(pick(after)) ? 'false' : 'true',
);
