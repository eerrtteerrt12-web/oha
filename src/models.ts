export type Project = {
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
}

export const DEFAULT_PROJECT: Project = {
  title: '두 유체의 혼합 공정',
  description:
    '농도가 다른 두 유체를 섞어 목표 농도를 만드는 물질수지 모델입니다.',
  source: '# 전체 유량과 성분 물질수지\nx + y = F\nc_A*x + c_B*y = c_T*F',
  parameters: [
    { id: 'F', name: 'F', value: 100, min: 20, max: 200, step: 1 },
    { id: 'c_A', name: 'c_A', value: 0.2, min: 0, max: 1, step: 0.01 },
    { id: 'c_B', name: 'c_B', value: 0.8, min: 0, max: 1, step: 0.01 },
    { id: 'c_T', name: 'c_T', value: 0.5, min: 0.2, max: 0.8, step: 0.01 },
  ],
  sweepName: 'c_T',
}

export const EXAMPLES: Array<{
  id: string
  category: string
  project: Project
}> = [
  { id: 'mixing', category: '화학공학 · 물질수지', project: DEFAULT_PROJECT },
  {
    id: 'first-equations',
    category: '기초 수학 · 2원 연립방정식',
    project: {
      title: '처음 만나는 연립방정식',
      description:
        '계수와 미지수만으로 두 방정식의 해를 구합니다. 2x는 2*x와 같습니다.',
      source:
        '# 숫자와 문자 사이의 곱셈 기호는 생략할 수 있어요\n2x + 3y = 12\n4x = 5 + y',
      parameters: [],
      sweepName: '',
    },
  },
  {
    id: 'three-variables',
    category: '기초 수학 · 3원 연립방정식',
    project: {
      title: '세 미지수의 균형',
      description:
        '세 개의 식으로 x, y, z를 계산합니다. 정답은 x = 3, y = 4, z = 5입니다.',
      source:
        '# 미지수 수와 독립적인 방정식 수를 맞춰주세요\nx + y + z = 12\n2x - y + z = 7\nx + 2y - z = 6',
      parameters: [],
      sweepName: '',
    },
  },
  {
    id: 'voltage-divider',
    category: '전기공학 · 전압 분배',
    project: {
      title: '직렬 저항의 전압 분배',
      description:
        '두 직렬 저항의 전압 U1, U2를 계산합니다. V는 전원 전압(V), R1과 R2는 저항(Ω)입니다.',
      source:
        '# 키르히호프 전압 법칙과 같은 전류 조건\nU1 + U2 = V\nR2*U1 = R1*U2',
      parameters: [
        { id: 'V', name: 'V', value: 12, min: 0, max: 24, step: 0.1 },
        { id: 'R1', name: 'R1', value: 100, min: 10, max: 1000, step: 10 },
        { id: 'R2', name: 'R2', value: 200, min: 10, max: 1000, step: 10 },
      ],
      sweepName: 'V',
    },
  },
]
