// Writes src/core/axe-rules.json from the installed axe-core. `npm run gen` at the root runs it
// and then formats the file with Prettier, so that the format check of `npm run ci` passes on the
// generated file.

import { writeFileSync } from 'node:fs';
import axe from 'axe-core';
import { CRITERIA } from '../src/core/criteria.ts';
import { buildAxeRuleMap, readAxeFacts } from './axe-rule-map.ts';

const map = buildAxeRuleMap(
  readAxeFacts(axe),
  CRITERIA.map(({ id }) => id),
);
const file = new URL('../src/core/axe-rules.json', import.meta.url);
writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`);
