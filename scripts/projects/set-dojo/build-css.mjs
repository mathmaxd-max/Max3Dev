import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..', '..');
const input = path.join(root, 'set_dojo_vanilla', 'styles.css');
const output = path.join(root, 'src', 'projects', 'set-dojo', 'set-dojo.css');

const raw = fs.readFileSync(input, 'utf8');

const rootMatch = raw.match(/:root\s*\{([^]*?)\n\}/);
if (!rootMatch) throw new Error('Expected :root block');

const themeVars = rootMatch[1].replace(/--set-color-[012]:[^;]+;\s*/g, '').trim();

const bodyMatch = raw.match(/\nbody\s*\{([^]*?)\n\}/);
if (!bodyMatch) throw new Error('Expected body block');

const bodyInner = bodyMatch[1].trim();

let rest = raw
  .replace(/:root\s*\{[^]*?\n\}\s*/m, '')
  .replace(/\*\s*\{[^]*?\n\}\s*/m, '')
  .replace(/\nhtml\s*\{[^]*?\n\}\s*/m, '')
  .replace(/\nbody\s*\{[^]*?\n\}\s*/m, '');

rest = rest.replace(/#board-heading/g, '#sd-board-heading');

const lines = rest.split('\n');
const outLines = [];

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed) {
    outLines.push(line);
    continue;
  }

  if (trimmed.startsWith('@media')) {
    outLines.push(line);
    continue;
  }

  if (trimmed.startsWith('}')) {
    outLines.push(line);
    continue;
  }

  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '';

  if (trimmed.startsWith('*') || trimmed.startsWith('.') || trimmed.startsWith('#') || trimmed.startsWith('[')) {
    outLines.push(`${indent}.set-dojo ${line.trimStart()}`);
    continue;
  }

  outLines.push(line);
}

const merged = `@import './generated-colors.css';

.set-dojo {
${themeVars}

${bodyInner}
}

.set-dojo *,
.set-dojo *::before,
.set-dojo *::after {
  box-sizing: border-box;
}

${outLines.join('\n')}
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, merged, 'utf8');
