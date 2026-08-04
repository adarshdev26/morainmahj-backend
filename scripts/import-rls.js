// Copies the row-level security rules out of the Base44 entity exports into
// src/config/rls.json, so the backend enforces them without depending on the
// frontend checkout at runtime.
//
// Usage: npm run import-rls [path-to-base44/entities]
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SOURCE = path.resolve(__dirname, '../../morain-mahj/base44/entities');
const TARGET = path.resolve(__dirname, '../src/config/rls.json');

// The exports are JSONC, so comments have to go before JSON.parse.
function parseJsonc(text) {
  return JSON.parse(
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  );
}

function main() {
  const source = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SOURCE;
  if (!fs.existsSync(source)) {
    throw new Error(`No entity exports at ${source}`);
  }

  const rules = {};
  let skipped = 0;

  for (const file of fs.readdirSync(source).sort()) {
    if (!file.endsWith('.jsonc')) continue;
    const entity = file.replace(/\.jsonc$/, '');
    const schema = parseJsonc(fs.readFileSync(path.join(source, file), 'utf8'));
    if (!schema.rls) {
      skipped += 1;
      continue;
    }
    rules[entity] = schema.rls;
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, `${JSON.stringify(rules, null, 2)}\n`);

  console.log(`Wrote ${Object.keys(rules).length} entity policies to ${path.relative(process.cwd(), TARGET)}`);
  if (skipped) console.log(`${skipped} entity export(s) carried no rls block and were skipped.`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
