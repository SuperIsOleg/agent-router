import { describe, expect, test } from 'claude-code/testing'

import { DEFAULTS, merge } from '../hooks/config'
import { judge, readBrief } from '../hooks/policy'
import { keywordPattern, maskNegations, ruStem, splitCode, typedText } from '../hooks/text'
import { agent, ROOT, world } from './world'

const PROJECT_CONFIG = `${ROOT}/.claude/agent-router.json`
const tierOf = (prompt: string, description = '', role: 'write' | 'search' | 'unknown' = 'write') => {
  const v = judge(role, readBrief({ description, prompt }, DEFAULTS), DEFAULTS)
  return v.kind === 'tier' ? v.tier : `abstain:${v.why}`
}

describe('only the typed text is scored', () => {
  test('fenced code, diffs, stack traces, log lines and quotes are dropped; list items stay', () => {
    const raw = [
      'Fix the import.',
      '```',
      'payment failed: auth error',
      '```',
      'diff --git a/x b/x',
      '@@ -1,2 +1,2 @@',
      '-old payment line',
      '+new payment line',
      '',
      'Traceback (most recent call last):',
      '  File "/srv/payments.py", line 3, in charge',
      'PaymentError: declined',
      '2026-03-12 11:10:10 INFO payment ok',
      '> quoted security note',
      '- keep this list item',
      '    - and its nested item',
    ].join('\n')
    const typed = typedText(raw)
    expect(typed).toContain('Fix the import.')
    expect(typed).toContain('- keep this list item')
    expect(typed).toContain('and its nested item')
    expect(typed).not.toMatch(/payment|security|Traceback/i)
  })

  test('an indented block after a blank line is code', () => {
    expect(typedText('Run this:\n\n    rm -rf payments/\n    echo done\n\nThen report.')).toBe('Run this:\n\nThen report.')
  })

  test('an unclosed fence drops the rest', () => {
    expect(typedText('Add the import.\n```\nsecurity token leaked')).toBe('Add the import.')
  })

  test('inline code, quoted strings, paths and identifiers are set aside as weak evidence', () => {
    const t = splitCode("Fix 'Pyament' in `PaymentSheetView` under services/payments/ and in AuthViewController.")
    expect(t.text).not.toMatch(/pay|auth/i)
    expect(t.code).toMatch(/PaymentSheetView/)
    expect(t.code).toMatch(/services\/payments\//)
    expect(t.code).toMatch(/AuthViewController/)
  })

  test('a payment log inside a fence does not raise a one-line import fix', () => {
    const prompt = 'The build failed:\n```\nPaymentSheetView.swift:41: error: cannot find Logger; payment security auth crash\n```\nAdd the missing `import os`.'
    expect(tierOf(prompt, 'fix missing import')).toBe('ordinary')
  })

  test('one weak identifier does not raise the tier, two do', () => {
    expect(tierOf('Add a log line in `PaymentSheetView`.', 'add a log line')).toBe('ordinary')
    expect(tierOf('Fix the rounding in `PaymentService.refund()`.', 'fix rounding')).toBe('risky')
  })
})

describe('negations', () => {
  test('a word the brief tells the agent not to touch does not raise the tier', () => {
    expect(maskNegations("Write the e2e tests. Do not touch any payment logic; use the mocks.")).not.toMatch(/payment/)
    expect(maskNegations('не трогай оплату, поправь опечатку')).not.toMatch(/оплат/)
    expect(maskNegations('не открывай файл с секретами. Напиши вопрос')).not.toMatch(/секрет/)
    expect(maskNegations("Don't redesign anything.")).not.toMatch(/redesign/)
    expect(maskNegations('Leave the auth module alone and fix the footer.')).not.toMatch(/auth/)
    expect(tierOf('Write Playwright tests for the checkout form. Do not touch any payment logic.', 'e2e tests')).toBe('ordinary')
    expect(tierOf('Fix the contrast on the landing page. Don\'t redesign anything.', 'a11y fixes')).toBe('ordinary')
  })

  test('a negated risk is still a risk', () => {
    expect(maskNegations('Users must not lose data.')).toMatch(/lose data/)
    expect(maskNegations('Пользователи не должны потерять данные.')).toMatch(/потерять данные/)
    expect(tierOf('Move the projects to the new store. Users must not lose data.', 'move storage')).toBe('risky')
  })

  test('the negation ends at the clause', () => {
    expect(maskNegations("Don't touch the UI, but fix the payment rounding.")).toMatch(/payment/)
    expect(maskNegations('не трогай вёрстку, а почини оплату')).toMatch(/оплату/)
  })
})

describe('Russian word forms', () => {
  test('a dictionary form matches its inflections, not other words', () => {
    expect(ruStem('миграция')).toBe('миграц')
    expect(keywordPattern('потеря данных').test('не должны потерять данные')).toBe(true)
    expect(keywordPattern('безопасность').test('проверь безопасности')).toBe(true)
    expect(keywordPattern('безопасность').test('получить ключ безопасно')).toBe(false)
    expect(keywordPattern('прод').test('выкатить на прод')).toBe(true)
    expect(keywordPattern('прод').test('карточка продукта')).toBe(false)
  })

  test('verb forms of a risky word raise the tier', () => {
    expect(tierOf('Нужно мигрировать хранилище проектов на SwiftData.', 'перенос проектов')).toBe('risky')
    expect(tierOf('Пользователь может быть не залогинен, учти это в диплинке.', 'диплинк')).toBe('risky')
  })
})

describe('abstain', () => {
  test('a brief too short to judge, a reference to earlier context, mixed signals', () => {
    expect(tierOf('fix it\n\nTypeError: undefined is not a function', 'Fix it')).toBe('abstain:vague')
    expect(tierOf('сделай как в прошлый раз, только для нового проекта', 'то же')).toBe('abstain:backref')
    expect(tierOf('Just tweak the copy.\n\nThe banner sits above the refund flow.', 'tweak copy')).toBe('abstain:mixed')
    expect(tierOf('Help with the thing.', '', 'unknown')).toBe('abstain:no-signal')
  })

  test('a risky word in the title is not a close call', () => {
    expect(tierOf('Just bump the timeout.', 'bump the payment timeout')).toBe('risky')
  })

  test('abstain: false routes to the middle default instead', () => {
    const config = merge(DEFAULTS, { abstain: false })
    const v = judge('write', readBrief({ prompt: 'fix it' }, config), config)
    expect(v).toEqual({ kind: 'tier', tier: 'ordinary', role: 'write' })
  })

  test('the route line keeps the agent default and says why', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'general-purpose', description: 'Fix it', prompt: 'fix it' }))
    expect(w.core[0]?.model).toBeUndefined()
    expect(w.core[0]?.effort).toBeUndefined()
    expect(String(w.core[0]?.prompt)).toMatch(/^route: opus — auto: abstain \(brief too short to judge\)\n\nfix it$/)
    expect(w.toasts[0]).toBe('general-purpose → opus (auto: abstain (brief too short to judge))')
  })

  test('a project default is used on abstain', async ($, on) => {
    const w = world(on, { files: { [PROJECT_CONFIG]: JSON.stringify({ default: { model: 'sonnet', effort: 'high' } }) } })
    await $.tool.call(agent({ description: 'Fix it', prompt: 'fix it' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'high'])
    expect(String(w.core[0]?.prompt)).toMatch(/^route: sonnet high — auto: abstain \(brief too short to judge; project default\)/)
  })
})

describe('the length floor', () => {
  test('a long, detailed read-only brief does not land on haiku', async ($, on) => {
    const w = world(on)
    const prompt = `Map the sync layer. ${'Describe each module, its inputs, outputs and owners in detail. '.repeat(30)}`
    await $.tool.call(agent({ subagent_type: 'Explore', prompt }))
    await $.tool.call(agent({ subagent_type: 'Explore', prompt: 'Find where the config is loaded.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'low'])
    expect(String(w.core[0]?.prompt)).toMatch(/long brief, not haiku/)
    expect(w.core[1]?.model).toBe('haiku')
  })

  test('a long pasted log is not a long brief', async ($, on) => {
    const w = world(on)
    const prompt = `Find the first error in this log.\n\`\`\`\n${'2026-01-01 10:00:00 INFO ok\n'.repeat(200)}\`\`\``
    await $.tool.call(agent({ subagent_type: 'Explore', prompt }))
    expect(w.core[0]?.model).toBe('haiku')
  })
})

describe('read-only intent', () => {
  test('a general-purpose brief that only lists or finds goes to the search tier', () => {
    expect(tierOf('list the files in ./docs sorted by last modified time, newest first')).toBe('search')
    expect(tierOf('Найди все использования UserDefaults и выдай список файлов.')).toBe('search')
    expect(tierOf('Find why the export is slow and fix it.')).toBe('ordinary')
  })
})
