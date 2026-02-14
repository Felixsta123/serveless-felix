import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , environment] = process.argv;

const projects = {
  dev: 'serverless-felix-dev',
  prd: 'serverless-felix-prd',
};

if (!environment || !(environment in projects)) {
  console.error('Usage: node scripts/deploy-monitoring.mjs <dev|prd>');
  process.exit(1);
}

const projectId = projects[environment];
const displayName = `Serverless Felix - Core Ops (${environment})`;
const templatePath = path.resolve('monitoring', 'dashboard.core.template.json');
const renderedPath = path.resolve('monitoring', `dashboard.${environment}.json`);

if (!fs.existsSync(templatePath)) {
  console.error(`Dashboard template not found: ${templatePath}`);
  process.exit(1);
}

const renderTemplate = () => {
  const template = fs.readFileSync(templatePath, 'utf8');
  const rendered = template
    .replace(/{{ENV}}/g, environment)
    .replace(/{{PROJECT_ID}}/g, projectId);

  const parsed = JSON.parse(rendered);
  fs.writeFileSync(renderedPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
};

const readRenderedConfig = () =>
  JSON.parse(fs.readFileSync(renderedPath, 'utf8'));

const writeRenderedConfig = (config) => {
  fs.writeFileSync(renderedPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
};

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

renderTemplate();

const existingName = runCapture([
  'monitoring',
  'dashboards',
  'list',
  '--project',
  projectId,
  '--filter',
  `displayName="${displayName}"`,
  '--format',
  'value(name)',
])
  .split('\n')
  .map((line) => line.trim())
  .find(Boolean);

let dashboardName = existingName;

if (dashboardName) {
  const currentDashboard = JSON.parse(
    runCapture([
      'monitoring',
      'dashboards',
      'describe',
      dashboardName,
      '--project',
      projectId,
      '--format',
      'json',
    ]),
  );

  const renderedConfig = readRenderedConfig();
  writeRenderedConfig({
    ...renderedConfig,
    name: currentDashboard.name,
    etag: currentDashboard.etag,
  });

  console.log(`Updating dashboard: ${dashboardName}`);
  runInherit([
    'monitoring',
    'dashboards',
    'update',
    dashboardName,
    '--project',
    projectId,
    '--config-from-file',
    renderedPath,
  ]);
} else {
  console.log(`Creating dashboard: ${displayName}`);
  runInherit([
    'monitoring',
    'dashboards',
    'create',
    '--project',
    projectId,
    '--config-from-file',
    renderedPath,
  ]);

  dashboardName = runCapture([
    'monitoring',
    'dashboards',
    'list',
    '--project',
    projectId,
    '--filter',
    `displayName="${displayName}"`,
    '--format',
    'value(name)',
  ])
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
}

if (!dashboardName) {
  console.error('Dashboard applied, but unable to resolve dashboard name.');
  process.exit(1);
}

const dashboardId = dashboardName.split('/').pop();
console.log(`Dashboard ID: ${dashboardId}`);
console.log(
  `Console URL: https://console.cloud.google.com/monitoring/dashboards/custom/${dashboardId}?project=${projectId}`,
);
console.log(`Rendered config: ${renderedPath}`);
