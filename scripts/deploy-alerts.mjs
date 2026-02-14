import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , environment] = process.argv;

const projects = {
  dev: 'serverless-felix-dev',
  prd: 'serverless-felix-prd',
};

if (!environment || !(environment in projects)) {
  console.error('Usage: node scripts/deploy-alerts.mjs <dev|prd>');
  process.exit(1);
}

const projectId = projects[environment];
const templatePath = path.resolve('monitoring', 'alert-policies.core.template.json');
const renderedPath = path.resolve('monitoring', `alert-policies.${environment}.json`);

if (!fs.existsSync(templatePath)) {
  console.error(`Alert policy template not found: ${templatePath}`);
  process.exit(1);
}

const runCapture = (args) => {
  const result = spawnSync('gcloud', args, { encoding: 'utf8' });
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

const runInherit = (args) => {
  const result = spawnSync('gcloud', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const renderPolicies = () => {
  const template = fs.readFileSync(templatePath, 'utf8');
  const rendered = template
    .replace(/{{ENV}}/g, environment)
    .replace(/{{PROJECT_ID}}/g, projectId);

  const parsed = JSON.parse(rendered);
  if (!Array.isArray(parsed.policies) || parsed.policies.length === 0) {
    throw new Error('Template must contain a non-empty policies array.');
  }

  fs.writeFileSync(renderedPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return parsed.policies;
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serverless-felix-alerts-'));

const writePolicyFile = (policy, index) => {
  const filePath = path.join(tempDir, `policy-${environment}-${index}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  return filePath;
};

try {
  const policies = renderPolicies();

  const existingPolicies = JSON.parse(
    runCapture([
      'monitoring',
      'policies',
      'list',
      '--project',
      projectId,
      '--format',
      'json',
    ]) || '[]',
  );

  const existingByDisplayName = new Map(
    existingPolicies
      .filter((policy) => typeof policy.displayName === 'string' && policy.displayName)
      .map((policy) => [policy.displayName, policy]),
  );

  const applied = [];

  for (const [index, policy] of policies.entries()) {
    if (!policy.displayName || typeof policy.displayName !== 'string') {
      console.error(`Policy at index ${index} is missing a valid displayName.`);
      process.exit(1);
    }

    const existing = existingByDisplayName.get(policy.displayName);
    const policyFilePath = (() => {
      if (!existing) {
        return writePolicyFile(policy, index);
      }

      const current = JSON.parse(
        runCapture([
          'monitoring',
          'policies',
          'describe',
          existing.name,
          '--project',
          projectId,
          '--format',
          'json',
        ]),
      );

      return writePolicyFile(
        {
          ...policy,
          name: current.name,
          etag: current.etag,
        },
        index,
      );
    })();

    if (!existing) {
      console.log(`Creating alert policy: ${policy.displayName}`);
      runInherit([
        'monitoring',
        'policies',
        'create',
        '--project',
        projectId,
        '--policy-from-file',
        policyFilePath,
      ]);
    } else {
      console.log(`Updating alert policy: ${policy.displayName}`);
      runInherit([
        'monitoring',
        'policies',
        'update',
        existing.name,
        '--project',
        projectId,
        '--policy-from-file',
        policyFilePath,
      ]);
    }

    applied.push(policy.displayName);
  }

  console.log('Applied alert policies:');
  for (const displayName of applied) {
    console.log(`- ${displayName}`);
  }
  console.log(`Rendered policies: ${renderedPath}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
