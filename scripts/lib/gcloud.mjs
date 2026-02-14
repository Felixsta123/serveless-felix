import { spawnSync } from 'node:child_process';

export const runResult = (args, options = {}) =>
  spawnSync('gcloud', args, options);

export const runCapture = (args) => {
  const result = runResult(args, { encoding: 'utf8' });
  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }
  return (result.stdout ?? '').trim();
};

export const runInherit = (args, options = {}) => {
  const result = runResult(args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

export const exists = (args) =>
  runResult(args, { stdio: 'ignore' }).status === 0;
