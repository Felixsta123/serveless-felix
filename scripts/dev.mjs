import { spawn } from 'node:child_process';
import { functions } from './functions.mjs';

const [, , functionName] = process.argv;

if (!functionName || !(functionName in functions)) {
  console.error('Usage: node scripts/dev.mjs <functionName>');
  console.error(`Known functions: ${Object.keys(functions).join(', ')}`);
  process.exit(1);
}

const config = functions[functionName];
const args = ['--target', functionName, '--source', 'src/index.ts'];

if (config.trigger === 'topic') {
  args.push('--signature-type', 'cloudevent');
}

if (process.env.PORT) {
  args.push('--port', process.env.PORT);
}

const nodeOptions = '--import=tsx';

const child = spawn('functions-framework', args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  },
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});
