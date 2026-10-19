import { describe, expect, it } from 'vitest';
import { evaluateExpression, ExprError } from '../../../src/core/expr';

describe('evaluateExpression', () => {
  it.each([
    ['42', 42],
    ['=2*25+10', 60],
    [' 1.5e2 ', 150],
    ['1,5', 1.5],
    ['-(3+4)*2', -14],
    ['2^3^2', 512],
    ['10/4', 2.5],
    ['sqrt(2)*sqrt(2)', 2],
    ['90-asin(0.5)', 60],
    ['cos(60)', 0.5],
    ['2*pi', 2 * Math.PI],
  ])('%s = %d', (input, expected) => {
    expect(evaluateExpression(input)).toBeCloseTo(expected, 12);
  });

  it.each(['', '2+', '(1', 'foo(2)', '1 2', '1/0', 'alert(1)'])('rejects %j', (input) => {
    expect(() => evaluateExpression(input)).toThrow(ExprError);
  });
});
