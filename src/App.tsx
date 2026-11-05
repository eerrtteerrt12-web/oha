import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Download,
  FileText,
  FolderOpen,
  Grid2X2,
  Layers3,
  LoaderCircle,
  Maximize2,
  Play,
  Plus,
  Settings2,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import SolutionChart, { SERIES_COLORS } from './components/SolutionChart'
import Guide from './components/Guide'
import { DEFAULT_PROJECT, EXAMPLES, type Project } from './models'
import type { SolvePayload } from './engine'

const STORAGE_KEY = 'polymath-studio-project-v1'
const colors = SERIES_COLORS
const fmt = (n: number, digits = 5) =>
  !Number.isFinite(n)
    ? n === Infinity
      ? '∞'
      : '—'
    : n === 0
      ? '0'
      : Math.abs(n) < 0.000001 || Math.abs(n) >= 1e9
        ? n.toExponential(Math.min(5, digits - 1))
        : Number(n.toPrecision(digits)).toLocaleString('en-US', {
            maximumFractionDigits: 8,
          })
function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false
  const p = value as Project
  return (
    typeof p.title === 'string' &&
    p.title.length <= 120 &&
    typeof p.description === 'string' &&
    typeof p.source === 'string' &&
    p.source.length <= 30000 &&
    typeof p.sweepName === 'string' &&
    Array.isArray(p.parameters) &&
    p.parameters.length <= 24 &&
    p.parameters.every(
      (v) =>
        !!v &&
        typeof v === 'object' &&
        typeof v.id === 'string' &&
        /^[A-Za-z][A-Za-z0-9_]*$/.test(v.name) &&
        [v.value, v.min, v.max, v.step].every(Number.isFinite) &&
        v.min < v.max &&
        Number.isFinite(v.max - v.min) &&
        v.step > 0 &&
        v.value >= v.min &&
        v.value <= v.max,
    ) &&
    new Set(p.parameters.map((v) => v.name)).size === p.parameters.length &&
    new Set(p.parameters.map((v) => v.id)).size === p.parameters.length
  )
}
function initialProject(): Project {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (isProject(p)) return p
  } catch {
    /* A clean model is usable if storage is unavailable. */
  }
  return structuredClone(DEFAULT_PROJECT)
}
function downloadFile(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function App() {
  const [project, setProject] = useState<Project>(initialProject)
  const [payload, setPayload] = useState<SolvePayload | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(true)
  const [workerReady, setWorkerReady] = useState(false)
  const [revision, setRevision] = useState(0)
  const [view, setView] = useState<'simulation' | 'report'>('simulation')
  const [detail, setDetail] = useState<'table' | 'matrix'>('table')
  const [guide, setGuide] = useState(false)
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [paramOpen, setParamOpen] = useState(false)
  const [paramName, setParamName] = useState('')
  const [paramValue, setParamValue] = useState('1')
  const [paramError, setParamError] = useState('')
  const [rangeEditor, setRangeEditor] = useState(false)
  const [toast, setToast] = useState('')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [visibleVariables, setVisibleVariables] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [storageOk, setStorageOk] = useState(true)
  const worker = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const importRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const examplesRef = useRef<HTMLDivElement>(null)
  const result = payload?.result
  const sweepParam = project.parameters.find(
    (p) => p.name === project.sweepName,
  )
  const sourceLines = project.source.split('\n')
  const equationCount = sourceLines.filter((l) => l.split('#')[0].trim()).length
  useEffect(() => {
    const w = new Worker(
      new URL('./engine/solver.worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.current = w
    w.onmessage = ({ data }) => {
      if (data.id !== requestId.current) return
      setPending(false)
      if (data.ok) {
        setPayload(data.payload)
        setError('')
      } else {
        setError(data.line ? `${data.line}행 · ${data.error}` : data.error)
        setPayload(null)
      }
    }
    w.onerror = () => {
      setPending(false)
      setError('계산 워커를 시작하지 못했습니다. 페이지를 새로고침해 주세요.')
    }
    setWorkerReady(true)
    return () => {
      w.terminate()
      worker.current = null
    }
  }, [])
  useEffect(() => {
    if (!workerReady) return
    const id = ++requestId.current
    setPending(true)
    setError('')
    setSelectedIndex(null)
    const timer = setTimeout(() => {
      worker.current?.postMessage({
        id,
        source: project.source,
        parameters: Object.fromEntries(
          project.parameters.map((p) => [p.name, p.value]),
        ),
        sweep: sweepParam
          ? {
              name: sweepParam.name,
              min: sweepParam.min,
              max: sweepParam.max,
              steps: 81,
            }
          : null,
      })
    }, 160)
    return () => clearTimeout(timer)
  }, [
    project.source,
    project.parameters,
    project.sweepName,
    revision,
    workerReady,
  ])
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
      setStorageOk(true)
    } catch {
      setStorageOk(false)
    }
  }, [project])
  const variableKey = result?.variables.join('|') || ''
  useEffect(() => {
    setVisibleVariables(variableKey ? variableKey.split('|') : [])
  }, [variableKey])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        setRevision((v) => v + 1)
      }
      if (e.key === 'Escape') {
        setGuide(false)
        setExamplesOpen(false)
        setParamOpen(false)
        setExpanded(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])
  useEffect(() => {
    if (!paramOpen) return
    const previous = document.activeElement as HTMLElement | null
    const dialog = document.querySelector<HTMLElement>('.parameter-modal')
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialog) return
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),[tabindex="0"]',
        ),
      )
      const first = controls[0],
        last = controls[controls.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      previous?.focus()
    }
  }, [paramOpen])
  useEffect(() => {
    if (!examplesOpen) return
    const close = (e: PointerEvent) => {
      if (!examplesRef.current?.contains(e.target as Node))
        setExamplesOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [examplesOpen])
  function loadExample(p: Project) {
    setProject(structuredClone(p))
    setExamplesOpen(false)
    setSelectedIndex(null)
    setView('simulation')
    setToast('예제 모델을 불러왔습니다.')
  }
  function updateParameter(id: string, value: number) {
    setProject((p) => ({
      ...p,
      parameters: p.parameters.map((v) =>
        v.id === id
          ? { ...v, value: Math.min(v.max, Math.max(v.min, value)) }
          : v,
      ),
    }))
  }
  function addParameter(e: React.FormEvent) {
    e.preventDefault()
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(paramName)) {
      setParamError('영문자로 시작하는 이름을 입력해 주세요. 예: F, c_A')
      return
    }
    if (
      [
        'sin',
        'cos',
        'tan',
        'sqrt',
        'log',
        'ln',
        'abs',
        'exp',
        'if',
        'then',
        'else',
        'and',
        'or',
        'constructor',
        '__proto__',
        'prototype',
      ].includes(paramName.toLowerCase()) ||
      project.parameters.some((v) => v.name === paramName)
    ) {
      setParamError('이미 사용 중이거나 예약된 이름입니다.')
      return
    }
    const value = Number(paramValue)
    if (!paramValue.trim() || !Number.isFinite(value)) {
      setParamError('유한한 숫자를 입력해 주세요.')
      return
    }
    const min = value > 0 ? 0 : value - 5,
      max = value > 0 ? value * 2 : Math.max(5, value + 5),
      step = Number(((max - min) / 100).toPrecision(4))
    if (
      ![min, max, step, max - min].every(Number.isFinite) ||
      !Number.isFinite(max - min) ||
      min >= max ||
      step <= 0
    ) {
      setParamError(
        '슬라이더로 표현할 수 있는 더 작은 범위의 값을 입력해 주세요.',
      )
      return
    }
    setProject((p) => ({
      ...p,
      parameters: [
        ...p.parameters,
        { id: crypto.randomUUID(), name: paramName, value, min, max, step },
      ],
      sweepName: p.sweepName || paramName,
    }))
    setParamOpen(false)
    setParamName('')
    setParamValue('1')
    setParamError('')
  }
  function exportReport() {
    if (!result || pending || error) return
    const body = `# ${project.title}\n\n${project.description}\n\n## 입력 수식\n\n\`\`\`text\n${project.source}\n\`\`\`\n\n## 파라미터\n\n${project.parameters.map((p) => `- ${p.name} = ${p.value}`).join('\n') || '없음'}\n\n## 해\n\n| 변수 | 값 |\n| --- | ---: |\n${result.variables.map((v, i) => `| ${v} | ${result.values[i].toPrecision(12)} |`).join('\n')}\n\n최대 절대 잔차: ${result.maxResidual.toExponential(5)}\n\n조건수 (∞-norm): ${result.condition.toPrecision(6)}\n\n계산 엔진: ${result.engine}\n\n${result.warnings.join('\n')}\n`
    downloadFile('polymath-report.md', body, 'text/markdown;charset=utf-8')
    setToast('계산 리포트를 내려받았습니다.')
  }
  function exportCSV() {
    if (!result || !payload || pending) return
    const csv = sweepParam
      ? [
          [project.sweepName, ...result.variables].join(','),
          ...payload.sweep.map((p) =>
            [p.parameter, ...(p.values || result.variables.map(() => ''))].join(
              ',',
            ),
          ),
        ].join('\n')
      : [
          ['variable', 'value'].join(','),
          ...result.variables.map((v, i) => [v, result.values[i]].join(',')),
        ].join('\n')
    downloadFile('polymath-data.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8')
    setToast('데이터를 CSV로 내려받았습니다.')
  }
  async function importProject(file?: File) {
    if (!file) return
    if (file.size > 150000) {
      setToast('150KB 이하의 프로젝트 파일을 선택해 주세요.')
      return
    }
    try {
      const p = JSON.parse(await file.text())
      if (!isProject(p)) throw new Error()
      setProject(p)
      setToast('프로젝트를 불러왔습니다.')
    } catch {
      setToast('올바른 Polymath 프로젝트 JSON 파일이 아닙니다.')
    }
  }
  const activePoint =
    selectedIndex !== null ? payload?.sweep[selectedIndex] : null
  const activeValues = activePoint?.values || result?.values
  return (
    <div className="app-shell">
      <aside className="rail" aria-label="주 메뉴">
        <a
          className="brand-mark"
          href="#"
          aria-label="Polymath Studio 홈"
          onClick={(e) => {
            e.preventDefault()
            setExpanded(false)
            setView('simulation')
          }}
        >
          <span>p</span>
          <i />
        </a>
        <div className="rail-group">
          <button
            className="rail-item active"
            title="모델 워크스페이스"
            aria-label="모델 워크스페이스"
            onClick={() => {
              setExpanded(false)
              editorRef.current?.focus()
            }}
          >
            <Layers3 size={21} />
            <span>모델</span>
          </button>
          <button
            className="rail-item"
            title="예제 라이브러리"
            aria-label="예제 라이브러리"
            onClick={() => setExamplesOpen((v) => !v)}
          >
            <BookOpen size={21} />
            <span>예제</span>
          </button>
        </div>
        <div className="rail-bottom">
          <button
            className="rail-item"
            onClick={() => setGuide(true)}
            aria-label="사용 가이드"
          >
            <CircleHelp size={21} />
            <span>가이드</span>
          </button>
          <div className="avatar" title="로컬 워크스페이스">
            ME
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="wordmark">
            polymath<span>studio</span>
            <span className="beta">PREVIEW</span>
          </div>
          <div className="top-right">
            <span className="local-status">
              <i />
              {storageOk ? '로컬 자동 저장' : '자동 저장 불가'}
            </span>
            <div className="top-divider" />
            <button className="quiet-button" onClick={() => setGuide(true)}>
              <CircleHelp size={16} />
              <span>사용 가이드</span>
            </button>
            <a
              className="github-link"
              href="https://github.com/kis3751-spec/polymath-exceeding-"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub 저장소"
            >
              <Code2 size={19} />
            </a>
          </div>
        </header>
        <main>
          <div className="breadcrumbs">
            <span>워크스페이스</span>
            <ChevronRight size={13} />
            <span>선형 방정식</span>
          </div>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> ENGINEERING, SIMPLIFIED
              </div>
              <h1>
                수식에서, <span>인사이트로.</span>
              </h1>
              <p>복잡한 코딩 없이 모델을 풀고, 변수의 가능성을 탐색하세요.</p>
            </div>
            <div className="heading-actions">
              <button
                className="secondary-button import-button"
                onClick={() => importRef.current?.click()}
              >
                <FolderOpen size={16} />
                <span>불러오기</span>
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  downloadFile(
                    'polymath-project.json',
                    JSON.stringify(project, null, 2),
                    'application/json',
                  )
                  setToast('프로젝트를 JSON 파일로 저장했습니다.')
                }}
              >
                <Download size={16} />
                <span>프로젝트 저장</span>
              </button>
            </div>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                void importProject(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </section>
          <div className="problem-tabs" aria-label="문제 유형">
            <button className="problem-tab selected">
              <Grid2X2 size={16} />
              선형 방정식 <span>LEQ</span>
            </button>
            <button
              className="problem-tab"
              disabled
              title="다음 버전에 추가됩니다"
            >
              <Activity size={16} />
              미분 방정식 <span>ODE</span>
            </button>
            <button
              className="problem-tab"
              disabled
              title="다음 버전에 추가됩니다"
            >
              <Sigma size={17} />
              비선형 방정식 <span>NLE</span>
            </button>
            <button
              className="problem-tab"
              disabled
              title="다음 버전에 추가됩니다"
            >
              <SlidersHorizontal size={16} />
              데이터 분석 <span>예정</span>
            </button>
            <div className="browser-badge">
              <span />내 브라우저에서 안전하게 연산
            </div>
          </div>
          <div className={`studio-grid ${expanded ? 'results-expanded' : ''}`}>
            <div className="model-column">
              <section className="panel model-panel">
                <div className="panel-heading">
                  <div className="section-label">
                    <span className="step-number">01</span>
                    <h2>모델 정의</h2>
                  </div>
                  <div className="examples-wrap" ref={examplesRef}>
                    <button
                      className="text-button"
                      aria-expanded={examplesOpen}
                      onClick={() => setExamplesOpen((v) => !v)}
                    >
                      예제 불러오기
                      <ChevronDown size={14} />
                    </button>
                    {examplesOpen && (
                      <div className="examples-menu">
                        <span className="menu-label">
                          작게 시작하는 엔지니어링
                        </span>
                        {EXAMPLES.map((ex) => (
                          <button
                            key={ex.id}
                            onClick={() => loadExample(ex.project)}
                          >
                            <span className="example-icon">
                              <Grid2X2 size={17} />
                            </span>
                            <span>
                              <b>{ex.project.title}</b>
                              <small>{ex.category}</small>
                            </span>
                            <ChevronRight size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="model-title">
                  <input
                    aria-label="모델 이름"
                    value={project.title}
                    maxLength={120}
                    onChange={(e) =>
                      setProject((p) => ({ ...p, title: e.target.value }))
                    }
                  />
                  <span className="model-tag">LINEAR SYSTEM</span>
                </div>
                <p className="model-description">{project.description}</p>
                <div className="editor-toolbar">
                  <span>
                    <Code2 size={14} />
                    수식 에디터
                  </span>
                  <span>한 줄에 하나의 방정식</span>
                </div>
                <div
                  className={`equation-editor ${error ? 'editor-error' : ''}`}
                >
                  <div className="line-numbers" aria-hidden="true">
                    {sourceLines.map((_, i) => (
                      <span key={i}>{String(i + 1).padStart(2, '0')}</span>
                    ))}
                  </div>
                  <textarea
                    ref={editorRef}
                    aria-label="방정식 입력"
                    spellCheck={false}
                    maxLength={30000}
                    value={project.source}
                    onChange={(e) =>
                      setProject((p) => ({ ...p, source: e.target.value }))
                    }
                    placeholder={'2x + 3y = 12\n4x = 5 + y'}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab') {
                        e.preventDefault()
                        const el = e.currentTarget,
                          start = el.selectionStart,
                          end = el.selectionEnd
                        setProject((p) => ({
                          ...p,
                          source:
                            p.source.slice(0, start) +
                            '  ' +
                            p.source.slice(end),
                        }))
                        requestAnimationFrame(() => {
                          el.selectionStart = el.selectionEnd = start + 2
                        })
                      }
                    }}
                  />
                </div>
                <div className="editor-footer">
                  <span>
                    <i
                      className={error ? 'status-dot error-dot' : 'status-dot'}
                    />
                    {equationCount}개 방정식
                    {result && !error
                      ? ` · ${result.variables.length}개 미지수`
                      : ''}
                  </span>
                  <button
                    className="text-button syntax-button"
                    onClick={() => setGuide(true)}
                  >
                    문법 알아보기
                    <ArrowRight size={13} />
                  </button>
                </div>
                <div className="model-run-row">
                  <span>
                    <span className="keycap">⌘</span> / Ctrl + Enter
                  </span>
                  <button
                    className="primary-button"
                    onClick={() => setRevision((v) => v + 1)}
                    disabled={pending}
                  >
                    {pending ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                    {pending ? '계산 중' : '모델 풀기'}
                    <span className="button-arrow">↗</span>
                  </button>
                </div>
              </section>
              <section className="panel parameter-panel">
                <div className="panel-heading">
                  <div className="section-label">
                    <span className="step-number">02</span>
                    <h2>파라미터</h2>
                    <span className="count-badge">
                      {project.parameters.length}
                    </span>
                  </div>
                  <button
                    className={`icon-button ${rangeEditor ? 'is-selected' : ''}`}
                    aria-label="파라미터 범위 설정"
                    title="파라미터 범위 설정"
                    onClick={() => setRangeEditor((v) => !v)}
                  >
                    <Settings2 size={16} />
                  </button>
                </div>
                <p className="section-description">
                  값을 움직여 모델의 변화를 확인하세요.
                </p>
                <div className="parameter-list">
                  {project.parameters.map((p, i) => (
                    <div className="parameter" key={p.id}>
                      <div className="parameter-top">
                        <div>
                          <label
                            htmlFor={`param-${p.id}`}
                            className="parameter-name"
                          >
                            {p.name}
                          </label>
                          <span className="parameter-role">
                            {p.name === project.sweepName
                              ? '탐색 변수'
                              : project.source === DEFAULT_PROJECT.source
                                ? (
                                    {
                                      F: '전체 유량',
                                      c_A: '유체 A 농도',
                                      c_B: '유체 B 농도',
                                    } as Record<string, string>
                                  )[p.name] || '상수'
                                : '상수'}
                          </span>
                        </div>
                        <div className="parameter-input-wrap">
                          <ParameterValueInput
                            parameter={p}
                            onCommit={(value) => updateParameter(p.id, value)}
                          />
                          {rangeEditor && (
                            <button
                              className="delete-param"
                              title={`${p.name} 삭제`}
                              aria-label={`${p.name} 삭제`}
                              onClick={() =>
                                setProject((prev) => ({
                                  ...prev,
                                  parameters: prev.parameters.filter(
                                    (v) => v.id !== p.id,
                                  ),
                                  sweepName:
                                    prev.sweepName === p.name
                                      ? prev.parameters.find(
                                          (v) => v.id !== p.id,
                                        )?.name || ''
                                      : prev.sweepName,
                                }))
                              }
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        id={`param-${p.id}`}
                        className="parameter-slider"
                        aria-label={`${p.name} 슬라이더`}
                        type="range"
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        value={p.value}
                        style={
                          {
                            '--range-fill': `${((p.value - p.min) / (p.max - p.min)) * 100}%`,
                          } as React.CSSProperties
                        }
                        onChange={(e) =>
                          updateParameter(p.id, Number(e.target.value))
                        }
                      />
                      <div className="range-labels">
                        <span>{fmt(p.min)}</span>
                        {i === 0 && (
                          <span>
                            {p.name === 'F'
                              ? '전체 유입 유량'
                              : '파라미터 범위'}
                          </span>
                        )}
                        <span>{fmt(p.max)}</span>
                      </div>
                      {rangeEditor && (
                        <RangeEditor
                          parameter={p}
                          onChange={(next) =>
                            setProject((prev) => ({
                              ...prev,
                              parameters: prev.parameters.map((v) =>
                                v.id === p.id ? next : v,
                              ),
                            }))
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
                {project.parameters.length === 0 && (
                  <div className="no-parameters">
                    <SlidersHorizontal size={22} />
                    <p>
                      수식 속 상수를 파라미터로 등록하면
                      <br />
                      슬라이더로 해의 변화를 탐색할 수 있어요.
                    </p>
                  </div>
                )}
                <button
                  className="add-parameter"
                  disabled={project.parameters.length >= 24}
                  onClick={() => {
                    setParamOpen(true)
                    setParamError('')
                  }}
                >
                  <Plus size={15} />
                  파라미터 추가
                </button>
                <div className="live-note">
                  <span className="live-dot" />
                  슬라이더를 움직이면 자동으로 다시 계산합니다.
                </div>
              </section>
              <div className="tip-card">
                <div className="tip-icon">
                  <Sparkles size={17} />
                </div>
                <p>
                  <b>작은 변화가 만드는 새로운 발견</b>
                  <span>
                    {project.source === DEFAULT_PROJECT.source
                      ? '목표 농도 c_T를 바꾸면, 필요한 두 유량이 어떻게 달라질까요?'
                      : '수식 속 상수를 파라미터로 등록해 해의 변화를 탐색해 보세요.'}
                  </span>
                </p>
                <ArrowRight size={16} />
              </div>
            </div>
            <div className={`results-column ${pending ? 'is-computing' : ''}`}>
              <section className="panel results-panel">
                <div className="results-heading">
                  <div className="section-label">
                    <span className="step-number">03</span>
                    <h2>결과 탐색</h2>
                  </div>
                  <div className="results-heading-right">
                    <span
                      className={`engine-status ${error ? 'has-error' : ''}`}
                    >
                      {pending ? (
                        <LoaderCircle size={12} className="spin" />
                      ) : error ? (
                        <X size={12} />
                      ) : (
                        <CheckCircle2 size={12} />
                      )}{' '}
                      {pending
                        ? '계산 중'
                        : error
                          ? '입력 확인'
                          : result?.engine === 'wasm'
                            ? 'WebAssembly'
                            : 'JavaScript'}
                    </span>
                    <button
                      className="icon-button"
                      title={expanded ? '기본 레이아웃' : '결과 화면 확대'}
                      aria-label={expanded ? '기본 레이아웃' : '결과 화면 확대'}
                      onClick={() => setExpanded((v) => !v)}
                    >
                      <Maximize2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="result-mode-tabs">
                  <button
                    className={view === 'simulation' ? 'active' : ''}
                    onClick={() => setView('simulation')}
                  >
                    <Activity size={15} />
                    인터랙티브 시뮬레이션<span className="new-badge">LIVE</span>
                  </button>
                  <button
                    className={view === 'report' ? 'active' : ''}
                    onClick={() => setView('report')}
                  >
                    <FileText size={15} />
                    해석 리포트
                  </button>
                </div>
                {error ? (
                  <div className="error-state" role="alert">
                    <div className="error-icon">
                      <Sigma size={24} />
                    </div>
                    <h3>수식을 한 번 확인해 주세요.</h3>
                    <p>{error}</p>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setGuide(true)
                      }}
                    >
                      입력 가이드 보기
                      <ArrowRight size={14} />
                    </button>
                  </div>
                ) : !result ? (
                  <div className="loading-state">
                    <LoaderCircle className="spin" size={26} />
                    <h3>수식을 해석하고 있습니다.</h3>
                    <p>잠시 후 모델의 해가 표시됩니다.</p>
                  </div>
                ) : (
                  <>
                    <div className="solution-summary">
                      <div className="summary-label">
                        <span className="found-badge">
                          <Check size={12} />
                          유일해
                        </span>
                        <span>
                          {result.variables.length}개 미지수의 해를 찾았습니다
                        </span>
                      </div>
                      <div
                        className={`solution-cards ${result.variables.length > 3 ? 'many-values' : ''}`}
                      >
                        {result.variables.map((v, i) => (
                          <div className="solution-value" key={v}>
                            <div>
                              <i
                                style={{
                                  background: colors[i % colors.length],
                                }}
                              />
                              <span>{v}</span>
                            </div>
                            <strong>{fmt(result.values[i], 7)}</strong>
                            <span className="value-caption">
                              {project.title === DEFAULT_PROJECT.title &&
                              (v === 'x' || v === 'y')
                                ? `유체 ${v === 'x' ? 'A' : 'B'}의 유량`
                                : '계산된 값'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {result.warnings.length > 0 && (
                      <div className="warning-box">
                        {result.warnings.map((w, i) => (
                          <p key={i}>{w}</p>
                        ))}
                      </div>
                    )}
                    {project.source === DEFAULT_PROJECT.source &&
                      result.values.some((v) => v < -1e-8) && (
                        <div className="warning-box physical-warning">
                          음수인 유량이 계산되었습니다. 수학적 해는 존재하지만,
                          실제 혼합에서는 목표 농도가 두 유체의 농도 사이에
                          있어야 합니다.
                        </div>
                      )}
                    {view === 'simulation' ? (
                      <>
                        <div className="chart-section">
                          <div className="chart-heading">
                            <div>
                              <h3>파라미터에 따른 해의 변화</h3>
                              <p>
                                한 변수를 움직이면, 해답은 어떻게 달라질까요?
                              </p>
                            </div>
                            <span className="chart-kicker">
                              PARAMETRIC EXPLORATION
                            </span>
                          </div>
                          {sweepParam ? (
                            <>
                              <div className="chart-controls">
                                <label htmlFor="sweep-param">탐색 변수</label>
                                <div className="select-wrap">
                                  <select
                                    id="sweep-param"
                                    value={project.sweepName}
                                    onChange={(e) =>
                                      setProject((p) => ({
                                        ...p,
                                        sweepName: e.target.value,
                                      }))
                                    }
                                  >
                                    {project.parameters.map((p) => (
                                      <option key={p.id} value={p.name}>
                                        {p.name}
                                      </option>
                                    ))}
                                  </select>
                                  <ChevronDown size={12} />
                                </div>
                                <span className="sweep-domain">
                                  {fmt(sweepParam.min)}
                                  <ArrowRight size={12} />
                                  {fmt(sweepParam.max)}
                                </span>
                                <span className="sample-count">
                                  {payload?.sweep.length}개 지점
                                </span>
                              </div>
                              <SolutionChart
                                points={payload?.sweep || []}
                                variables={result.variables}
                                parameterName={project.sweepName}
                                currentParameter={sweepParam.value}
                                currentValues={result.values}
                                selectedIndex={selectedIndex}
                                onSelectIndex={setSelectedIndex}
                                visibleVariables={visibleVariables}
                                onToggleVariable={(v) =>
                                  setVisibleVariables((prev) =>
                                    prev.includes(v)
                                      ? prev.filter((n) => n !== v)
                                      : [...prev, v],
                                  )
                                }
                              />
                              <p className="chart-footnote">
                                <span className="chart-current-dot" />
                                점선은 현재 설정값입니다. 그래프 위에 마우스를
                                올려 값을 확인하세요.
                              </p>
                            </>
                          ) : (
                            <div className="empty-chart">
                              <Activity size={34} />
                              <h4>상수에 움직임을 더해 보세요.</h4>
                              <p>
                                파라미터를 추가하고 수식에 사용하면
                                <br />
                                해의 변화를 그래프로 탐색할 수 있습니다.
                              </p>
                              <button
                                className="text-button"
                                onClick={() => setParamOpen(true)}
                              >
                                첫 파라미터 추가
                                <Plus size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="data-section">
                          <div className="data-toolbar">
                            <div className="data-tabs">
                              <button
                                className={detail === 'table' ? 'active' : ''}
                                onClick={() => setDetail('table')}
                              >
                                <Grid2X2 size={13} />
                                데이터 표
                              </button>
                              <button
                                className={detail === 'matrix' ? 'active' : ''}
                                onClick={() => setDetail('matrix')}
                              >
                                행렬 보기
                              </button>
                            </div>
                            <button
                              className="text-button"
                              disabled={pending}
                              onClick={exportCSV}
                            >
                              <ArrowDownToLine size={13} />
                              CSV
                            </button>
                          </div>
                          {detail === 'matrix' ? (
                            <MatrixView result={result} />
                          ) : sweepParam && payload ? (
                            <SweepTable
                              payload={payload}
                              parameterValue={sweepParam.value}
                              selectedIndex={selectedIndex}
                              onSelectIndex={setSelectedIndex}
                            />
                          ) : (
                            <div className="table-scroll">
                              <table className="result-table">
                                <thead>
                                  <tr>
                                    <th>
                                      {activePoint
                                        ? `${project.sweepName} = ${fmt(activePoint.parameter)}`
                                        : '변수'}
                                    </th>
                                    <th>값</th>
                                    <th>방정식 최대 절대 잔차</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {result.variables.map((v, i) => (
                                    <tr
                                      key={v}
                                      className={
                                        activePoint ? 'highlighted' : ''
                                      }
                                    >
                                      <td>
                                        <span
                                          className="table-color"
                                          style={{
                                            background:
                                              colors[i % colors.length],
                                          }}
                                        />
                                        {v}
                                      </td>
                                      <td>
                                        {activePoint && !activePoint.values
                                          ? '해 없음'
                                          : fmt(activeValues?.[i] ?? NaN, 10)}
                                      </td>
                                      <td>
                                        {activePoint
                                          ? '—'
                                          : result.maxResidual.toExponential(2)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="report-content">
                        <div className="report-title">
                          <div className="report-document-icon">
                            <FileText size={22} />
                          </div>
                          <div>
                            <span>ANALYSIS REPORT</span>
                            <h3>{project.title}</h3>
                          </div>
                          <button
                            className="secondary-button"
                            disabled={pending}
                            onClick={exportReport}
                          >
                            <Download size={14} />
                            리포트 저장
                          </button>
                        </div>
                        <div className="report-metrics">
                          <div>
                            <span>최대 절대 잔차</span>
                            <strong>
                              {result.maxResidual.toExponential(3)}
                            </strong>
                          </div>
                          <div>
                            <span>조건수 · ∞-norm</span>
                            <strong>{fmt(result.condition, 6)}</strong>
                          </div>
                          <div>
                            <span>계산 시간</span>
                            <strong>
                              {fmt(result.durationMs, 3)}
                              <small> ms</small>
                            </strong>
                          </div>
                        </div>
                        <h4>01 / 입력 모델</h4>
                        <pre>{project.source}</pre>
                        <h4>02 / 파라미터</h4>
                        <div className="report-param-list">
                          {project.parameters.length ? (
                            project.parameters.map((p) => (
                              <span key={p.id}>
                                {p.name}
                                <b>{fmt(p.value, 10)}</b>
                              </span>
                            ))
                          ) : (
                            <p>별도로 정의된 파라미터가 없습니다.</p>
                          )}
                        </div>
                        <h4>03 / 수치 검증</h4>
                        <p className="report-explanation">
                          부분 피벗팅을 사용하는 가우스 소거법으로 A·x = b를
                          풉니다. 잔차는 입력한 각 방정식에서 좌변과 우변의
                          차이이며, 조건수가 클수록 입력값의 작은 오차에 해가
                          민감하게 반응할 수 있습니다.
                        </p>
                        <MatrixView result={result} />
                        <div className="residual-list">
                          {result.residuals.map((r, i) => (
                            <div key={i}>
                              <span>방정식 {i + 1}</span>
                              <code>{r.toExponential(3)}</code>
                              <CheckCircle2 size={13} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="result-footer">
                      <span>
                        <span className="status-dot" />
                        {pending ? '새 설정으로 계산 중…' : '계산 완료'}
                        <i>·</i>
                        {fmt(result.durationMs, 3)} ms
                      </span>
                      <span>
                        부분 피벗팅 · {result.matrix.length} ×{' '}
                        {result.variables.length}
                      </span>
                    </div>
                  </>
                )}
              </section>
              {view === 'simulation' && (
                <div className="insight-card">
                  <span className="insight-icon">
                    <ArrowLeftRight size={20} />
                  </span>
                  <div>
                    <b>정적인 정답을 넘어, 변화의 관계를 이해하세요.</b>
                    <p>
                      여러 파라미터 중 하나를 선택해 해의 변화를 탐색할 수
                      있습니다.
                    </p>
                  </div>
                  <span className="insight-symbol">ƒ(x)</span>
                </div>
              )}
            </div>
          </div>
          <footer className="page-footer">
            <span>
              polymath<span className="footer-studio"> studio</span>
              <i />
              모델링의 다음 가능성
            </span>
            <span>
              LEQ Preview <span className="footer-dot">·</span> 데이터는 이
              브라우저에만 저장됩니다.
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
          <button aria-label="알림 닫기" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {guide && <Guide onClose={() => setGuide(false)} />}
      {paramOpen && (
        <div className="modal-backdrop" onClick={() => setParamOpen(false)}>
          <section
            className="parameter-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="parameter-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="닫기"
              onClick={() => setParamOpen(false)}
            >
              <X size={19} />
            </button>
            <span className="modal-eyebrow">MAKE IT INTERACTIVE</span>
            <h2 id="parameter-dialog-title">상수를 파라미터로.</h2>
            <p>
              알려진 값을 등록하고 수식에서 이름으로 사용하세요.
              <br />
              슬라이더 범위는 추가 후 설정에서 바꿀 수 있습니다.
            </p>
            <form onSubmit={addParameter}>
              <label>
                이름
                <input
                  autoFocus
                  placeholder="예: k, F, concentration"
                  maxLength={40}
                  value={paramName}
                  onChange={(e) => setParamName(e.target.value)}
                />
              </label>
              <label>
                현재 값
                <input
                  type="number"
                  step="any"
                  value={paramValue}
                  onChange={(e) => setParamValue(e.target.value)}
                />
              </label>
              {paramError && (
                <p className="form-error" role="alert">
                  {paramError}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setParamOpen(false)}
                >
                  취소
                </button>
                <button className="primary-button" type="submit">
                  <Plus size={15} />
                  파라미터 추가
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
function MatrixView({
  result,
}: {
  result: NonNullable<SolvePayload['result']>
}) {
  return (
    <div className="matrix-view">
      <div className="matrix-caption">
        A · x = b <span>입력 수식을 자동으로 행렬로 변환합니다.</span>
      </div>
      <div className="matrix-equation">
        <div className="matrix-bracket">
          <table>
            <tbody>
              {result.matrix.map((row, i) => (
                <tr key={i}>
                  {row.map((n, j) => (
                    <td key={j}>{fmt(n)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="matrix-dot">·</span>
        <div className="matrix-bracket">
          <table>
            <tbody>
              {result.variables.map((v) => (
                <tr key={v}>
                  <td className="matrix-variable">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span>=</span>
        <div className="matrix-bracket">
          <table>
            <tbody>
              {result.rhs.map((n, i) => (
                <tr key={i}>
                  <td>{fmt(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
function RangeEditor({
  parameter: p,
  onChange,
}: {
  parameter: Project['parameters'][number]
  onChange: (p: Project['parameters'][number]) => void
}) {
  const [range, setRange] = useState({
    min: String(p.min),
    max: String(p.max),
    step: String(p.step),
  })
  const [error, setError] = useState('')
  return (
    <form
      className="range-editor"
      onSubmit={(e) => {
        e.preventDefault()
        const min = Number(range.min),
          max = Number(range.max),
          step = Number(range.step)
        if (
          Object.values(range).some((v) => !v.trim()) ||
          ![min, max, step].every(Number.isFinite) ||
          !Number.isFinite(max - min) ||
          min >= max ||
          step <= 0
        ) {
          setError('최솟값 < 최댓값, 간격 > 0이어야 합니다.')
          return
        }
        setError('')
        onChange({
          ...p,
          min,
          max,
          step,
          value: Math.max(min, Math.min(max, p.value)),
        })
      }}
    >
      {(['min', 'max', 'step'] as const).map((k, i) => (
        <label key={k}>
          {['최솟값', '최댓값', '간격'][i]}
          <input
            aria-label={`${p.name} ${['최솟값', '최댓값', '간격'][i]}`}
            type="number"
            step="any"
            value={range[k]}
            onChange={(e) => setRange((v) => ({ ...v, [k]: e.target.value }))}
          />
        </label>
      ))}
      <button
        type="submit"
        title="범위 적용"
        aria-label={`${p.name} 범위 적용`}
      >
        <Check size={14} />
      </button>
      {error && <span role="alert">{error}</span>}
    </form>
  )
}
function SweepTable({
  payload,
  parameterValue,
  selectedIndex,
  onSelectIndex,
}: {
  payload: SolvePayload
  parameterValue: number
  selectedIndex: number | null
  onSelectIndex: (index: number | null) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const rows = useRef<(HTMLTableRowElement | null)[]>([])
  useEffect(() => {
    if (selectedIndex === null) return
    const el = rows.current[selectedIndex],
      parent = scroller.current
    if (!el || !parent) return
    const rowTop = el.offsetTop,
      headHeight = 35
    if (rowTop < parent.scrollTop + headHeight)
      parent.scrollTop = Math.max(0, rowTop - headHeight)
    else if (rowTop + el.offsetHeight > parent.scrollTop + parent.clientHeight)
      parent.scrollTop = rowTop + el.offsetHeight - parent.clientHeight
  }, [selectedIndex])
  return (
    <>
      <div className="sweep-table-caption">
        <span>
          {selectedIndex === null
            ? '현재값과 탐색 데이터를 함께 확인하세요.'
            : `탐색 지점 ${selectedIndex + 1} / ${payload.sweep.length}`}
        </span>
        <span>행을 선택하면 그래프와 연결됩니다.</span>
      </div>
      <div
        className="table-scroll sweep-table-scroll"
        ref={scroller}
        onPointerLeave={() => onSelectIndex(null)}
      >
        <table className="result-table sweep-table">
          <thead>
            <tr>
              <th>{payload.sweepName}</th>
              {payload.result.variables.map((v, i) => (
                <th key={v}>
                  <span
                    className="table-color"
                    style={{ background: colors[i % colors.length] }}
                  />
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="current-value-row">
              <td>
                {fmt(parameterValue)}
                <span className="current-row-badge">현재</span>
              </td>
              {payload.result.values.map((v, i) => (
                <td key={i}>{fmt(v, 9)}</td>
              ))}
            </tr>
            {payload.sweep.map((p, i) => (
              <tr
                key={i}
                ref={(el) => {
                  rows.current[i] = el
                }}
                tabIndex={0}
                aria-label={`${payload.sweepName} ${fmt(p.parameter)} 탐색`}
                aria-selected={selectedIndex === i}
                className={selectedIndex === i ? 'highlighted' : ''}
                onPointerEnter={() => onSelectIndex(i)}
                onFocus={() => onSelectIndex(i)}
                onClick={() => onSelectIndex(i)}
                onBlur={() => onSelectIndex(null)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    rows.current[
                      Math.min(i + 1, payload.sweep.length - 1)
                    ]?.focus()
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    rows.current[Math.max(0, i - 1)]?.focus()
                  }
                }}
              >
                <td>{fmt(p.parameter)}</td>
                {payload.result.variables.map((_, j) => (
                  <td key={j}>{p.values ? fmt(p.values[j], 9) : '해 없음'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ParameterValueInput({
  parameter: p,
  onCommit,
}: {
  parameter: Project['parameters'][number]
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(p.value))
  useEffect(() => setDraft(String(p.value)), [p.value])
  const commit = () => {
    const value = Number(draft)
    if (!draft.trim() || !Number.isFinite(value)) {
      setDraft(String(p.value))
      return
    }
    const next = Math.min(p.max, Math.max(p.min, value))
    setDraft(String(next))
    onCommit(next)
  }
  return (
    <input
      aria-label={`${p.name} 값`}
      title={`범위 ${p.min} ~ ${p.max} · Enter로 적용`}
      type="number"
      min={p.min}
      max={p.max}
      step="any"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') {
          setDraft(String(p.value))
          e.currentTarget.blur()
        }
      }}
    />
  )
}
