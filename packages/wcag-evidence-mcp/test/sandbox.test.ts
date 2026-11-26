// The setting that turns Chromium's sandbox off (ADR 0008). It guards security, so it reads two
// forms and refuses every other one.

import { describe, expect, it } from 'vitest';
import { NO_SANDBOX_VARIABLE, readSandboxSetting } from '../src/core/sandbox.ts';

describe('readSandboxSetting', () => {
  it('keeps the sandbox when the variable is unset, and turns it off only for 1', () => {
    expect(readSandboxSetting(undefined)).toStrictEqual({ ok: true, sandbox: true });
    expect(readSandboxSetting('1')).toStrictEqual({ ok: true, sandbox: false });
  });

  it.each(['', '0', 'true', 'TRUE', 'yes', ' 1', '1 ', '01', 'on'])(
    'refuses %j, without repeating it',
    (value) => {
      const setting = readSandboxSetting(value);

      expect(setting).toMatchObject({ ok: false });
      expect(setting.ok ? '' : setting.message).toContain(NO_SANDBOX_VARIABLE);
    },
  );
});
