export type Typed = {
  text: string
  code: string
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/
const OUTPUT_OPEN = /^\s*<(output|stdout|stderr|tool_result|tool_output|function_results|result|logs?)\b[^>]*>/i
const DIFF_HEADER = /^(diff --git |index [0-9a-f]+\.\.[0-9a-f]+|--- (a\/|\/dev\/null)|\+\+\+ (b\/|\/dev\/null)|@@ .* @@)/
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/

const NOISE: readonly RegExp[] = [
  /^\s*\[?\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/,
  /^\s*\[?\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s/,
  /^\s*\[?(?:INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL|CRITICAL|NOTICE)\]?[\s:]/,
  /^\s*Traceback \(most recent call last\)/,
  /^\s*File "[^"]+", line \d+/,
  /^\s*at\s+(?:async\s+)?[\w$.<>[\]/:-]+\s*\(?[^\s()]*:\d+(?::\d+)?\)?\s*$/,
  /^\s*at\s+[\w$.<>]+\s*\([^)]*\)\s*$/,
  /^\s*\d+\s+[\w.-]+\s+0x[0-9a-f]+\s/i,
  /^\s*(?:Thread \d+|Exception Type:|Exception Subtype:|Exception Codes:|Termination Reason:|Crashed Thread:|Incident Identifier:|Hardware Model:)/,
  /^\s*(?:[\w$]+\.)*[\w$]*(?:Error|Exception|Panic|Fault)(?:\s*\[[^\]]*\])?:\s/,
  /^\s*(?:panic|fatal error|segmentation fault|SIGSEGV|SIGABRT|EXC_[A-Z_]+)\b/,
  /^\s*\S+\.\w+:\d+(?::\d+)?:\s*(?:error|warning|note|fatal error):/i,
  /^\s*(?:npm (?:ERR!|WARN)|yarn (?:error|warn)|error\[E\d+\]|warning:|error:|\*\* BUILD (?:FAILED|SUCCEEDED) \*\*)/i,
  /^\s*(?:FAIL|PASS|ok|not ok)\s+\S/,
  /^\s*[✓✔✕✗✘×●›]\s/,
  /^\s*(?:Test Suites|Tests|Snapshots|Time|Ran all test suites):/,
  /^\s*>/,
  /^\s*\$ \S/,
  /^\s*(?:Compile\w*|Ld|CodeSign|ProcessInfoPlistFile|PhaseScriptExecution|SwiftCompile|SwiftDriver)\s+\S/,
]

export function typedText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  let fence: string | undefined
  let output: string | undefined
  let inDiff = false
  let inIndented = false
  let previousBlank = true
  let previousList = false
  for (const line of lines) {
    if (fence !== undefined) {
      if (line.trim().startsWith(fence)) fence = undefined
      continue
    }
    if (output !== undefined) {
      if (new RegExp(`</${output}\\s*>`, 'i').test(line)) output = undefined
      continue
    }
    const open = FENCE_OPEN.exec(line)
    if (open !== null) {
      fence = open[1]
      continue
    }
    const tag = OUTPUT_OPEN.exec(line)
    if (tag !== null) {
      if (!new RegExp(`</${tag[1]}\\s*>`, 'i').test(line)) output = tag[1]
      continue
    }
    const blank = line.trim() === ''
    if (DIFF_HEADER.test(line)) {
      inDiff = true
      continue
    }
    if (inDiff) {
      if (/^[+\- ]/.test(line) && !blank) continue
      inDiff = false
    }
    const indented = /^(?: {4,}|\t)\S/.test(line) && !LIST_ITEM.test(line)
    if (indented && (previousBlank || inIndented) && !previousList) {
      inIndented = true
      continue
    }
    if (!blank) inIndented = false
    if (NOISE.some(re => re.test(line))) {
      previousBlank = false
      continue
    }
    kept.push(line)
    if (!blank) previousList = LIST_ITEM.test(line) || (previousList && /^\s+\S/.test(line))
    previousBlank = blank
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const INLINE_CODE = /`([^`\n]+)`/g
const PATH = /(?<![\p{L}\p{N}])(?:[\w.@~-]+\/)+[\w.@*-]*|(?<![\p{L}\p{N}/])[\w-]+\.(?:swift|m|mm|h|kt|java|ts|tsx|js|jsx|mjs|py|rb|go|rs|php|cs|cpp|c|md|json|ya?ml|toml|sql|sh|ipynb|xcconfig|plist|gradle|tf|html|css|scss)\b/gu
const IDENTIFIER = /(?<![\p{L}\p{N}])(?:[a-z]+[A-Z][\w]*|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|[a-z0-9]+(?:_[a-z0-9]+)+|[A-Z0-9]+(?:_[A-Z0-9]+)+)(?![\p{L}\p{N}])/gu
const QUOTED = /(?<![\p{L}\p{N}])'([^'\n]{1,60})'(?![\p{L}\p{N}])|"([^"\n]{1,60})"|«([^»\n]{1,60})»|“([^”\n]{1,60})”/gu

export function splitCode(text: string): Typed {
  const code: string[] = []
  const take = (re: RegExp, s: string) =>
    s.replace(re, (whole: string, ...groups: unknown[]) => {
      const inner = groups.slice(0, 4).find((g): g is string => typeof g === 'string') ?? whole
      code.push(inner)
      return ' '
    })
  let rest = take(INLINE_CODE, text)
  rest = take(QUOTED, rest)
  rest = take(PATH, rest)
  rest = take(IDENTIFIER, rest)
  return { text: rest.replace(/[ \t]{2,}/g, ' '), code: code.join('\n') }
}

const NEG_EN =
  /\b(?:don['’]?t|do not|never|must not|mustn['’]?t|should not|shouldn['’]?t|please do not|please don['’]?t|no need to|avoid|without)\s+(?:(?:ever|even|please|you|to|any|try to|go)\s+)*(?:touch|touching|change|changing|modify|modifying|edit|editing|open|opening|read|reading|look at|looking at|use|using|refactor|refactoring|redesign|redesigning|rename|renaming|move|moving|alter|altering|update|updating|commit|push|deploy|run|apply|print|include|add|rewrite|rewriting|restructure|fix|fixing|mess with|go near)\b/gi
const NEG_EN_NOUN = /\b(?:no|without|zero)\s+(?:changes?|edits?|modifications?|redesign|refactor(?:ing)?)\s+(?:to|in|of|on)\b|\bleave\b(?=[^.;!?\n]{0,60}\b(?:alone|untouched|as is|as-is|unchanged)\b)|\bexcept\b|\bout of scope\b|\bnot in scope\b/gi
const NEG_RU =
  /(?<![\p{L}])(?:не|ни в коем случае не|никогда не|не надо|не нужно|не стоит|не вздумай)\s+(?:(?:надо|нужно|стоит|пожалуйста)\s+)*(?:трогай|трогать|трогайте|трожь|тронь|меняй|менять|меняйте|изменяй|изменять|изменяйте|измени|изменить|правь|править|правьте|правку|правки|поправляй|поправлять|открывай|открывать|открой|открыть|редактируй|редактировать|лезь|лезть|касайся|касаться|затрагивай|затрагивать|затронь|затрагивая|переписывай|переписывать|перепиши|переписать|переделывай|переделывать|переделай|переделать|рефактори\p{L}*|переименовывай|переименовывать|переименуй|переименовать|переноси|переносить|перенеси|перенести|удаляй|удалять|удаляйте|удали|удалить|коммить|коммитить|закоммить|пушь|пушить|запушь|деплой|деплоить|задеплой|выкатывай|выкатывать|выкати|читай|читать|смотри|используй|использовать|добавляй|добавлять)(?![\p{L}])/giu
const NEG_RU_NOUN = /(?<![\p{L}])(?:без|никаких)\s+(?:изменени\p{L}*|правок|правки|редизайн\p{L}*|рефакторинг\p{L}*|переделк\p{L}*)(?:\s+(?:в|во|на|по))?|(?<![\p{L}])кроме(?![\p{L}])|(?<![\p{L}])вне\s+скоупа/giu
const CLAUSE_END = /[.;:!?\n,]|\s(?:but|however|instead|но|однако|а|зато)\s|\s[—–-]\s/iu

function maskAfter(text: string, re: RegExp): string {
  let out = ''
  let last = 0
  re.lastIndex = 0
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index < last) continue
    const start = m.index
    const tail = text.slice(start + m[0].length)
    const end = CLAUSE_END.exec(tail)
    const stop = start + m[0].length + (end === null ? tail.length : end.index)
    out += text.slice(last, start) + ' '.repeat(stop - start)
    last = stop
    re.lastIndex = stop
  }
  return out + text.slice(last)
}

export function maskNegations(text: string): string {
  let out = maskAfter(text, NEG_EN)
  out = maskAfter(out, NEG_EN_NOUN)
  out = maskAfter(out, NEG_RU)
  return maskAfter(out, NEG_RU_NOUN)
}

const RU_ENDINGS = [
  'иями', 'ями', 'ами', 'иях', 'ться', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ией',
  'ях', 'ах', 'ых', 'их', 'ий', 'ый', 'ой', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ую', 'юю', 'ом', 'ем',
  'ам', 'ям', 'ов', 'ев', 'ей', 'ия', 'ье', 'ья', 'тся', 'ть', 'ют', 'ут', 'ет', 'ит', 'ят', 'ат',
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й',
]

export function ruStem(word: string): string {
  if (word.length < 5 || !/^\p{Script=Cyrillic}+$/u.test(word)) return word
  for (const ending of RU_ENDINGS)
    if (word.endsWith(ending) && word.length - ending.length >= 4) return word.slice(0, -ending.length)
  return word
}

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

export function keywordPattern(keyword: string): RegExp {
  const words = keyword.trim().toLowerCase().split(/\s+/)
  const body = words
    .map(word => {
      if (word.includes('*')) return word.split('*').map(escape).join('\\p{L}*')
      if (!/^\p{Script=Cyrillic}{5,}$/u.test(word)) return escape(word)
      return `${escape(ruStem(word))}\\p{L}{0,5}`
    })
    .join('[\\s\\-]+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'u')
}

export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length
}

const PATH_TOKEN = /(?<![\p{L}\p{N}])(?:[\w.@~-]+\/)+[\w.@-]*|(?<![\p{L}\p{N}/])[\w-]+\.[a-z]{1,8}\b/giu

export function pathsIn(text: string): string[] {
  return [...new Set((text.match(PATH_TOKEN) ?? []).map(p => p.replace(/^\.\//, '').replace(/\.+$/, '')))]
}
