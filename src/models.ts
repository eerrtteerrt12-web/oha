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
  nonlinearSearch?: 'auto' | 'manual'
  searchBounds?: { min: number; max: number }
  selectedSolution?: number
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
    '방정식을 그대로 입력하면 실수 해를 자동으로 탐색합니다. 발견한 해를 선택해 결과를 비교하세요.',
  source: '',
  parameters: [],
  sweepName: '',
  conditionNorm: 'infinity',
  nonlinearSearch: 'auto',
}

export const NONLINEAR_EXAMPLES: Array<{
  id: string
  category: string
  project: Project
}> = [
  {
    id: 'positive-root',
    category: '기초 · 여러 실근과 파라미터',
    project: {
      mode: 'nonlinear',
      nonlinearSearch: 'auto',
      title: '제곱식의 두 실근',
      description:
        'x² = target에서 양수와 음수 실근을 함께 탐색합니다. 각 해를 선택하고 target 변화에 따른 결과를 비교하세요.',
      source:
        '# 식을 그대로 적으면 실수 해를 자동으로 탐색합니다\nx^2 = target',
      parameters: [
        { id: 'target', name: 'target', value: 4, min: 1, max: 25, step: 1 },
      ],
      sweepName: 'target',
      conditionNorm: 'infinity',
    },
  },
  {
    id: 'cubic-roots',
    category: '기초 · 세 개의 실근',
    project: {
      mode: 'nonlinear',
      nonlinearSearch: 'auto',
      title: '세 실근을 가진 삼차식',
      description:
        '하나의 방정식에서 x = 1, 2, 3을 탐색합니다. 해 목록에서 각 결과를 선택해 잔차와 리포트를 확인하세요.',
      source:
        '# 한 방정식에도 여러 실수 해가 있을 수 있습니다\n(x - 1)*(x - 2)*(x - 3) = 0',
      parameters: [],
      sweepName: '',
      conditionNorm: 'infinity',
    },
  },
  {
    id: 'circle-intersection',
    category: '연립 · 여러 교점 자동 탐색',
    project: {
      mode: 'nonlinear',
      nonlinearSearch: 'auto',
      title: '원과 직선의 교점',
      description:
        '원과 직선의 두 교점 (-3, -4), (4, 3)을 자동으로 탐색합니다. 해 목록에서 각 교점을 선택하세요.',
      source:
        '# 미지수 수와 독립적인 방정식 수를 맞춰 주세요\nx^2 + y^2 = 25\nx - y = 1',
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
      nonlinearSearch: 'auto',
      title: '비선형 물질수지와 평형 농도',
      description:
        'k·C² + C = C0의 두 실근을 탐색합니다. 기본값에서는 약 -3.236068과 1.236068이며, 실제 농도로 해석할 때는 양수 해를 선택하세요.',
      source:
        '# 수학적 실근 중 물리적으로 가능한 농도를 선택하세요\nk*C^2 + C = C0',
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
      nonlinearSearch: 'auto',
      title: '보조식으로 나누어 쓰는 비선형 모델',
      description:
        '보조식 t를 분리한 f(x) 문법도 자동 탐색에 사용할 수 있습니다. 상용로그 log를 사용하며, 자동 탐색에서 x = 20을 찾습니다.',
      source:
        '# f(x) 형식에서는 이름=수식을 보조식으로 사용할 수 있습니다\nf(x) = t + 4*x^2 - 1620\nt = x*log(x/2)',
      parameters: [],
      sweepName: '',
      conditionNorm: 'infinity',
    },
  },
]
