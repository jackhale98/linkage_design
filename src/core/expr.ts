// Safe arithmetic expressions for numeric fields, e.g. "2*25+10", "=sqrt(2)*50",
// "1,5" (decimal comma) or "90-asin(0.5)". No variables, no eval().
//
// Grammar:
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := unary ('^' factor)?
//   unary  := ('-' | '+') unary | atom
//   atom   := number | 'pi' | name '(' expr ')' | '(' expr ')'
// Trig functions take and return degrees, matching how angles are entered.

const DEG = Math.PI / 180;

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: (x) => Math.sin(x * DEG),
  cos: (x) => Math.cos(x * DEG),
  tan: (x) => Math.tan(x * DEG),
  asin: (x) => Math.asin(x) / DEG,
  acos: (x) => Math.acos(x) / DEG,
  atan: (x) => Math.atan(x) / DEG,
};

export class ExprError extends Error {}

export function evaluateExpression(input: string): number {
  let s = input.trim();
  if (s.startsWith('=')) s = s.slice(1);
  // A lone decimal comma ("1,5") is a decimal separator.
  if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  let i = 0;

  const peek = () => {
    while (s[i] === ' ') i++;
    return s[i];
  };
  const expect = (ch: string) => {
    if (peek() !== ch) throw new ExprError(`Expected "${ch}"`);
    i++;
  };

  const atom = (): number => {
    const c = peek();
    if (c === '(') {
      i++;
      const v = expr();
      expect(')');
      return v;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const name = /^[a-zA-Z]+/.exec(s.slice(i));
    if (name) {
      i += name[0].length;
      const n = name[0].toLowerCase();
      if (n === 'pi') return Math.PI;
      const f = FUNCTIONS[n];
      if (!f) throw new ExprError(`Unknown name "${name[0]}"`);
      expect('(');
      const v = expr();
      expect(')');
      return f(v);
    }
    throw new ExprError(c === undefined ? 'Unexpected end' : `Unexpected "${c}"`);
  };
  const unary = (): number => {
    const c = peek();
    if (c === '-') {
      i++;
      return -unary();
    }
    if (c === '+') {
      i++;
      return unary();
    }
    return atom();
  };
  const factor = (): number => {
    const base = unary();
    if (peek() === '^') {
      i++;
      return base ** factor();
    }
    return base;
  };
  const term = (): number => {
    let v = factor();
    for (;;) {
      const c = peek();
      if (c === '*') {
        i++;
        v *= factor();
      } else if (c === '/') {
        i++;
        v /= factor();
      } else return v;
    }
  };
  const expr = (): number => {
    let v = term();
    for (;;) {
      const c = peek();
      if (c === '+') {
        i++;
        v += term();
      } else if (c === '-') {
        i++;
        v -= term();
      } else return v;
    }
  };

  if (s.trim() === '') throw new ExprError('Enter a value');
  const v = expr();
  if (peek() !== undefined) throw new ExprError(`Unexpected "${s[i]}"`);
  if (!Number.isFinite(v)) throw new ExprError('Result is not a finite number');
  return v;
}
