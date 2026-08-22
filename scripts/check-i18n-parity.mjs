#!/usr/bin/env node
/**
 * Fails when a translation key exists in one locale and not the other.
 *
 * A missing key is invisible until a user hits that exact screen in that exact
 * language, which is the worst possible moment to discover it. Making it a build
 * failure moves the discovery to the person adding the string.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'apps/web/src/lib/i18n.ts'), 'utf8');

function keysForLocale(locale) {
  const start = source.indexOf(`  '${locale}': {`) >= 0
    ? source.indexOf(`  '${locale}': {`)
    : source.indexOf(`  ${locale}: {`);
  if (start < 0) throw new Error(`locale block not found: ${locale}`);

  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const block = source.slice(start, end);
  return new Set([...block.matchAll(/^\s{4}'([^']+)':/gm)].map((m) => m[1]));
}

const pt = keysForLocale("pt-BR");
const en = keysForLocale('en');

const missingInEn = [...pt].filter((k) => !en.has(k));
const missingInPt = [...en].filter((k) => !pt.has(k));

if (missingInEn.length === 0 && missingInPt.length === 0) {
  console.log(`✓ i18n parity: ${pt.size} keys in both pt-BR and en`);
  process.exit(0);
}

if (missingInEn.length > 0) console.error(`✗ missing in en (${missingInEn.length}):`, missingInEn);
if (missingInPt.length > 0) console.error(`✗ missing in pt-BR (${missingInPt.length}):`, missingInPt);
process.exit(1);
