import type { ConditionNorm } from './engine'

export type SolverMode = 'linear' | 'nonlinear'

export type Project = {
  mode?: SolverMode
  title: string
  description: string
  source: string
  parameters: Array<{
    id: string
    name: string
    value: number
    min: number
    max: number
    step: number
  }>
  sweepName: string
  conditionNorm?: ConditionNorm
}

export const DEFAULT_PROJECT: Project = {
  mode: 'linear',
  title: '새 선형 모델',
  description: '방정식을 한 줄씩 입력하고 조절할 값을 파라미터로 추가하세요.',
  source: '',
  parameters: [],
  sweepName: '',
  conditionNorm: 'infinity',
}

export const DEFAULT_NONLINEAR_PROJECT: Project = {
  mode: 'nonlinear',
  title: '새 비선형 모델',
  description:
    'f(미지수) = 잔차식을 입력하고 탐색 구간 또는 초기 추정값을 지정하세요.',
  source: '',
  parameters: [],
  sweepName: '',
  conditionNorm: 'infinity',
}

export const NONLINEAR_EXAMPLES: Array<{
  id: string
  category: string
  project: Project
}> = [
  {
    id: 'positive-root',
    category: '기초 · 하나의 미지수',
    project: {
      mode: 'nonlinear',
      title: '제곱식의 양의 근',
      description:
        'x² = target의 양의 해를 구합니다. target을 바꾸면 제곱근이 어떻게 달라지는지 확인할 수 있습니다.',
      source:
        '# f(x)의 오른쪽 식이 0이 되는 x를 찾습니다\nf(x) = x^2 - target\nx(min) = 0\nx(max) = 10',
      parameters: [
        { id: 'target', name: 'target', value: 4, min: 1, max: 25, step: 1 },
      ],
      sweepName: 'target',
      conditionNorm: 'infinity',
    },
  },
  {
    id: 'negative-root',
    category: '기초 · 탐색 구간과 여러 근',
    project: {
      mode: 'nonlinear',
      title: '같은 식에서 음의 근 찾기',
      description:
        'x² = 4에는 두 해가 있습니다. 탐색 구간을 -3~0으로 정하면 음의 해 x = -2를 찾습니다.',
      source:
        '# 양의 근과 음의 근은 서로 다른 구간에서 탐색하세요\nf(x) = x^2 - 4\nx(min) = -3\nx(max) = 0',
      parameters: [],
      sweepName: '',
      conditionNorm: 'infinity',
    },
  },
  {
    id: 'circle-intersection',
    category: '연립 · 초기 추정값',
    project: {
      mode: 'nonlinear',
      title: '원과 직선의 교점',
      description:
        'x² + y² = 25와 x - y = 1을 동시에 풉니다. 초기 추정값 (4, 3)은 한 교점을 선택하며, 다른 시작값에서는 다른 교점을 찾을 수 있습니다.',
      source:
        '# 식마다 f(미지수)를 하나씩 정의합니다\nf(x) = x^2 + y^2 - 25\nf(y) = x - y - 1\nx(0) = 4\ny(0) = 3',
      parameters: [],
      sweepName: '',
      conditionNorm: 'infinity',
    },
  },
  {
    id: 'equilibrium-concentration',
    category: '화학공학 · 평형 농도',
    project: {
      mode: 'nonlinear',
      title: '비선형 물질수지와 평형 농도',
      description:
        '평형 관계 k·C² + C = C0를 만족하는 양의 농도 C를 구합니다. k와 C0를 바꾸며 정상상태 농도를 비교하세요.',
      source:
        '# k*C^2 + C = C0를 잔차식으로 표현합니다\nf(C) = k*C^2 + C - C0\nC(min) = 0\nC(max) = 10',
      parameters: [
        { id: 'k', name: 'k', value: 0.5, min: 0.1, max: 2, step: 0.1 },
        { id: 'C0', name: 'C0', value: 2, min: 0.5, max: 5, step: 0.1 },
      ],
      sweepName: 'C0',
      conditionNorm: 'infinity',
    },
  },
  {
    id: 'helper-logarithm',
    category: '응용 · 보조식과 로그 함수',
    project: {
      mode: 'nonlinear',
      title: '보조식으로 나누어 쓰는 비선형 모델',
      description:
        '제공된 문법 문서의 단일 미지수 예제입니다. t를 보조식으로 분리하고 상용로그 log를 사용합니다. 이 구간의 해는 x = 20입니다.',
      source:
        '# log는 밑이 10인 로그입니다. 자연로그는 ln을 사용하세요\nf(x) = t + 4*x^2 - 1620\nt = x*log(x/2)\nx(min) = 0.1\nx(max) = 100',
      parameters: [],
      sweepName: '',
      conditionNorm: 'infinity',
    },
  },
]
