import { describe, expect, it } from 'vitest'
import { ModelError } from '../src/engine'
import { compileNonlinear } from '../src/engine/nonlinear-parser'

const interval = (expression: string) =>
  `f(x) = ${expression}\nx(min)=0.1\nx(max)=100`

describe('nonlinear mathematical source compilation', () => {
  it('evaluates the reference NLE0 example and forward explicit dependencies in source order', () => {
    const model = compileNonlinear('x = a + b^2\nb=4\na=1\nx+2', [])
    expect(model.kind).toBe('evaluation')
    expect(model.variables).toEqual([])
    expect(model.evaluate([], {})).toMatchObject({
      residuals: [],
      auxiliary: { x: 17, b: 4, a: 1 },
      evaluationNames: ['x', 'b', 'a', 'result_1'],
      evaluationValues: [17, 4, 1, 19],
    })
  })

  it('supports the reference NLE1 helper expression, decimal log and scientific literals', () => {
    const model = compileNonlinear(
      '# helper can follow the root\nf(x) = t + 4*x^2 - 1620\nt=x*log(x/2)\nx(min)=1e-1\nx(max)=+1.0E2',
      [],
    )
    expect(model.variables).toEqual(['x'])
    expect(model.rootLines).toEqual([2])
    expect(model.bounds).toEqual({ min: 0.1, max: 100 })
    expect(model.evaluate([20], {})).toMatchObject({
      residuals: [0],
      auxiliary: { t: 20 },
    })
  })

  it('supports the reference NLES variable order, initial guesses and dependent helper', () => {
    const model = compileNonlinear(
      'f(c)=3.8907-ln(6*c)-a\nf(a)=a+b-c\nb=5*a-3\nc(0)=2\na(0)=2',
      [],
    )
    expect(model.variables).toEqual(['c', 'a'])
    expect(model.guesses).toEqual([2, 2])
    const evaluated = model.evaluate([2, 2], {})
    expect(evaluated.residuals[0]).toBeCloseTo(3.8907 - Math.log(12) - 2, 13)
    expect(evaluated.residuals[1]).toBe(7)
    expect(evaluated.auxiliary.b).toBe(7)
  })

  it('preserves mathematical exponent precedence and numeric coefficient shorthand', () => {
    const expressions = [
      '-x^2',
      '2^-2',
      '2^3^2',
      '2x^2',
      '2(x+1)',
      '(x+1)(x-1)',
    ]
    const expected = [-9, 0.25, 512, 18, 8, 8]
    expressions.forEach((expression, index) =>
      expect(
        compileNonlinear(interval(expression), []).evaluate([3], {})
          .residuals[0],
      ).toBe(expected[index]),
    )
  })

  it('computes supported elementary functions and constants without JavaScript evaluation', () => {
    const model = compileNonlinear(
      'a=sin(pi/2)+cos(0)+tan(0)+exp(0)+ln(e)+log(100)+sqrt(4)+abs(-3)+pow(2,3)+min(1,2)+max(1,2)',
      [],
    )
    expect(model.evaluate([], {}).evaluationValues[0]).toBe(22)
  })

  it('reuses compiled source with fresh external parameter values and helper values', () => {
    const source = 'f(x)=a*x-target\na=scale^2\nx(min)=0\nx(max)=10'
    const first = compileNonlinear(source, ['target', 'scale'])
    const second = compileNonlinear(source, ['scale', 'target'])
    expect(first).toBe(second)
    expect(first.evaluate([2], { scale: 3, target: 18 }).residuals).toEqual([0])
    expect(first.evaluate([2], { scale: 4, target: 18 }).residuals).toEqual([
      14,
    ])
    expect(first.evaluate([2], { scale: 3, target: 18 }).auxiliary.a).toBe(9)
  })

  it('evaluates a long helper dependency chain without recursive compilation', () => {
    const definitions = [
      'a0=1',
      ...Array.from(
        { length: 1200 },
        (_, index) => `a${index + 1}=a${index}+1`,
      ),
    ]
    const model = compileNonlinear(definitions.reverse().join('\n'), [])
    expect(model.evaluate([], {}).auxiliary.a1200).toBe(1201)
  })

  it('gives anonymous expression outputs unique names when a helper uses result_1', () => {
    expect(
      compileNonlinear('result_1=4\nresult_1+1', []).evaluate([], {})
        .evaluationNames,
    ).toEqual(['result_1', 'result_2'])
  })

  it('keeps literal anonymous outputs distinct from a result_1 helper', () => {
    const evaluated = compileNonlinear('result_1=2\n3', []).evaluate([], {})
    expect(evaluated.evaluationNames).toEqual(['result_1', 'result_2'])
    expect(evaluated.evaluationValues).toEqual([2, 3])
    expect(evaluated.auxiliary).toEqual({ result_1: 2 })
  })

  it('skips parameter and helper names for several anonymous outputs', () => {
    const evaluated = compileNonlinear(
      'result_4=7\nresult_1+1\nresult_2+1\nresult_4+1',
      ['result_1', 'result_2'],
    ).evaluate([], { result_1: 2, result_2: 3 })
    expect(evaluated.evaluationNames).toEqual([
      'result_4',
      'result_3',
      'result_5',
      'result_6',
    ])
    expect(new Set(evaluated.evaluationNames).size).toBe(4)
    expect(evaluated.evaluationValues).toEqual([7, 3, 4, 8])
  })

  it('avoids external parameter names in anonymous-only evaluation mode', () => {
    const evaluated = compileNonlinear('result_1+1\n9', ['result_1']).evaluate(
      [],
      { result_1: 2 },
    )
    expect(evaluated.evaluationNames).toEqual(['result_2', 'result_3'])
    expect(evaluated.evaluationValues).toEqual([3, 9])
    expect(evaluated.auxiliary).toEqual({})
  })
})

describe('line-aware nonlinear input validation', () => {
  const invalidPrograms: Array<[string, string, number | undefined]> = [
    ['f(x)=x-z\nx(min)=0\nx(max)=3', '정의되지 않은', 1],
    ['a=b+1\nb=a+1', '순환', 1],
    ['f(x)=x-a\na=a+1\nx(min)=0\nx(max)=3', '순환', 2],
    ['f(x)=x-1\nx=1\nx(min)=0\nx(max)=3', '중복', 2],
    ['a=1\na=2', '중복', 2],
    ['f(x)=x-1\nf(x)=x-2\nx(min)=0\nx(max)=3', '중복', 2],
    ['f(x)=x-1=0\nx(min)=0\nx(max)=3', '등호', 1],
    ['f(x)=x-1\nx(0)=1', '초기값 대신', 2],
    ['f(x)=x-1\ny(min)=0\nx(max)=3', '대응하는', 2],
    ['f(x)=x-1\nx(min)=0\nx(min)=1\nx(max)=3', '중복', 3],
    ['f(x)=x-1\nx(min)=0', '경계를 모두', 1],
    ['f(x)=x-1\nx(min)=3\nx(max)=0', '작아야', 3],
    ['f(x)=x-1\nx(min)=0+1\nx(max)=3', '숫자를 직접', 2],
    ['f(x)=x+y\nf(y)=x-y\nx(0)=0', 'y(0)', 2],
    ['f(x)=x+y\nf(y)=x-y\nx(min)=0\ny(0)=0', '경계 대신', 3],
    ['f(x)=x-1\nx(min)=0\nx(max)=3\nx+1', '익명', 4],
    ['#@ NLE_SOLUTION_METHOD_INDEX = 3\nf(x)=x', '아직 지원', 1],
    ['f(x)=x+y\nf(y)=x-y\nx(0)=0 >=0\ny(0)=0', '아직 지원', 3],
    ['d(x)/d(t)=-x', '형식으로', 1],
    ['sin=1', '변수 이름', 1],
    ['a=unknown(1)', '지원하지 않는 함수', 1],
    ['a=sin(1,2)', '인수', 1],
    ['a=pow(2)', '인수', 1],
    ['a=', '등호 오른쪽', 1],
  ]
  it.each(invalidPrograms)(
    'rejects invalid source %s',
    (source, message, line) => {
      try {
        compileNonlinear(source, [])
        expect.fail('invalid source was accepted')
      } catch (error) {
        expect(error).toBeInstanceOf(ModelError)
        expect((error as Error).message).toContain(message)
        expect((error as ModelError).line).toBe(line)
      }
    },
  )

  it.each([
    'a=globalThis.alert(1)',
    'a=window["x"]',
    'a=constructor(1)',
    'a=1;throw(2)',
    'a=(()=>1)()',
  ])('rejects executable input %s', (source) => {
    expect(() => compileNonlinear(source, [])).toThrow(ModelError)
  })

  it('reports real-domain and overflow errors at the expression source line', () => {
    for (const expression of [
      'ln(-x)',
      'sqrt(-x)',
      '1/(x-1)',
      'exp(1000)',
      '(-x)^0.5',
    ]) {
      const model = compileNonlinear(
        `# header\nf(x)=${expression}\nx(min)=0\nx(max)=3`,
        [],
      )
      try {
        model.evaluate([1], {})
        expect.fail('undefined real-domain value was accepted')
      } catch (error) {
        expect(error).toBeInstanceOf(ModelError)
        expect((error as ModelError).line).toBe(2)
      }
    }
  })

  it('validates external parameter declarations and each supplied value', () => {
    expect(() => compileNonlinear(interval('x-a'), ['a', 'a'])).toThrow(
      '서로 달라야',
    )
    expect(() => compileNonlinear(interval('x-a'), ['sin'])).toThrow(
      '변수 이름',
    )
    expect(() => compileNonlinear(interval('x-a'), ['x'])).toThrow(
      '이미 파라미터',
    )
    expect(() => compileNonlinear('a=1', ['a'])).toThrow('이미 파라미터')
    const model = compileNonlinear(interval('x-a'), ['a'])
    expect(() => model.evaluate([1], {})).toThrow('파라미터')
    expect(() => model.evaluate([1], { a: Infinity })).toThrow('유한한')
    expect(() => model.evaluate([NaN], { a: 1 })).toThrow('유한하지')
    expect(() => model.evaluate([], { a: 1 })).toThrow('변수 개수')
  })

  it('rejects excessive input, deeply nested input and more than 16 roots safely', () => {
    expect(() => compileNonlinear('a=1' + ' '.repeat(30_000), [])).toThrow(
      '30,000자',
    )
    expect(() =>
      compileNonlinear(`a=${'('.repeat(100)}1${')'.repeat(100)}`, []),
    ).toThrow('너무 깊게')
    expect(() =>
      compileNonlinear(
        Array.from({ length: 17 }, (_, index) => `f(x${index})=x${index}`).join(
          '\n',
        ),
        [],
      ),
    ).toThrow('최대 16개')
  })
})
