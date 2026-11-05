import { useEffect, useRef } from 'react'
import { ArrowRight, BookOpen, Check, Lightbulb, X } from 'lucide-react'
import type { SolverMode } from '../models'
import './Guide.css'

export default function Guide({
  mode = 'linear',
  onClose,
}: {
  mode?: SolverMode
  onClose: () => void
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const nonlinear = mode === 'nonlinear'

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = dialog.current.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex="0"]',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault()
        last?.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  return (
    <div
      className="guide-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="guide-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        tabIndex={-1}
      >
        <header className="guide-header">
          <div className="guide-book">
            <BookOpen size={22} />
          </div>
          <button
            className="guide-close"
            onClick={onClose}
            aria-label="사용 가이드 닫기"
          >
            <X size={21} />
          </button>
          <p className="guide-eyebrow">
            EQUATION SOLVER · {nonlinear ? 'NONLINEAR' : 'LINEAR'}
          </p>
          <h2 id="guide-title">
            {nonlinear
              ? '0이 되는 값을 찾아보세요.'
              : '수식을 쓰는 것부터 시작하세요.'}
          </h2>
          <p>복잡한 코딩 없이, 익숙한 수학 문법으로 모델을 만듭니다.</p>
        </header>

        <div className="guide-content">
          <section className="guide-section">
            <span className="guide-step">01</span>
            <div>
              <h3>
                {nonlinear ? '식을 잔차식으로 바꾸세요' : '한 줄에 방정식 하나'}
              </h3>
              {nonlinear ? (
                <>
                  <p>
                    <code>x^2 = 4</code>를 풀려면 모든 항을 한쪽으로 옮겨{' '}
                    <code>f(x) = x^2 - 4</code>로 적으세요. <code>f(x)</code>는
                    오른쪽 식이 0이 되는 <strong>x를 찾으라</strong>는 뜻입니다.
                    뒤에 <code>= 0</code>을 덧붙이지 않습니다.
                  </p>
                  <pre className="guide-code">
                    <span># 한 미지수: 근을 찾을 구간을 지정합니다</span>
                    {'\n'}f(x) = x^2 - 4{'\n'}x(min) = 0{'\n'}x(max) = 3
                  </pre>
                  <p className="guide-small">
                    min과 max에는 숫자를 쓰고 min &lt; max로 정하세요. 이
                    구간에서 함수가 연속이고 양 끝의 잔차 부호가 달라야 합니다.
                    근이 구간 끝에 있는 경우도 허용합니다. 단일 미지수 모드에는
                    초기 추정값을 함께 쓰지 않습니다.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    모르는 값은 문자로, 알고 있는 값은 숫자로 적으세요. 양쪽
                    모두에 미지수가 있어도 괜찮습니다.
                  </p>
                  <pre className="guide-code">
                    <span># 두 식, 두 미지수</span>
                    {'\n'}2x + 3y = 12{'\n'}4x = 5 + y
                  </pre>
                </>
              )}
              <div className="guide-rule">
                <Check size={14} />
                <span>
                  <code>2x</code>와 <code>2*x</code>는 같은 뜻입니다.
                </span>
              </div>
              {!nonlinear && (
                <p className="guide-small">
                  <code>2*(x + y)</code> 같은 괄호와 <code>x/2</code>처럼 알려진
                  값으로 나누기도 지원합니다. 미지수끼리 곱하거나 제곱하는 식은
                  Nonlinear 탭에서 입력하세요.
                </p>
              )}
            </div>
          </section>

          <section className="guide-section">
            <span className="guide-step">02</span>
            <div>
              {nonlinear ? (
                <>
                  <h3>여러 미지수에는 초기 추정값을 주세요</h3>
                  <p>
                    미지수마다 <code>f(미지수)</code> 식과{' '}
                    <code>미지수(0)</code> 초기 추정값을 하나씩 적으세요. 식은
                    모든 미지수를 함께 참조할 수 있으며, 식 수와 미지수 수를
                    맞춰야 합니다.
                  </p>
                  <pre className="guide-code">
                    <span># 원과 직선의 교점을 함께 구합니다</span>
                    {'\n'}f(x) = x^2 + y^2 - 25{'\n'}f(y) = x - y - 1{'\n'}x(0)
                    = 4{'\n'}y(0) = 3
                  </pre>
                  <p className="guide-small">
                    초기 추정값은 숫자로 적습니다. <code>x(0)</code>의 0은
                    탐색을 시작할 추정값을 뜻하며 시간이 아닙니다. 연립 모드에는
                    min/max 구간을 함께 쓰지 않습니다. 시작값에 따라 다른 근을
                    찾거나 수렴하지 않을 수 있습니다.
                  </p>
                </>
              ) : (
                <>
                  <h3>미지수와 파라미터를 구분해요</h3>
                  <p>
                    <strong>미지수</strong>는 계산으로 구할 값입니다.{' '}
                    <strong>파라미터</strong>는 내가 조절하는 알려진 값으로,
                    파라미터 패널에 추가합니다.
                  </p>
                  <div className="guide-equation">
                    <code>x + y = F</code>
                    <ArrowRight size={17} />
                    <span>
                      <b>x, y</b>를 구하고 <b>F</b>를 조절해요
                    </span>
                  </div>
                  <p className="guide-small">
                    파라미터로 등록하지 않은 문자는 모두 미지수입니다. 이름은
                    영문자로 시작하고 영문·숫자·밑줄(_)을 사용하세요. 대소문자를
                    구분합니다.
                  </p>
                </>
              )}
            </div>
          </section>

          {nonlinear && (
            <section className="guide-section">
              <span className="guide-step">03</span>
              <div>
                <h3>파라미터와 보조식으로 모델을 나누세요</h3>
                <p>
                  조절할 상수는 파라미터 패널에 추가합니다. 반복되는 계산은{' '}
                  <code>h = ln(x)</code>처럼 보조식으로 정의해{' '}
                  <code>f(x) = h - target</code>에서 사용할 수 있습니다. 여기서
                  x는 미지수, h는 보조값, target은 패널에 추가할 파라미터입니다.
                </p>
                <p className="guide-small">
                  보조식의 입력 순서는 자유롭지만 서로 순환해서 참조할 수
                  없습니다. 이름을 미지수나 파라미터와 중복해서 정의하지 마세요.
                  이름은 영문자로 시작하고 영문·숫자·밑줄(_)을 사용하며,
                  대소문자를 구분합니다.
                </p>
                <p className="guide-small">
                  <code>ln(x)</code>는 자연로그, <code>log(x)</code>는 밑이 10인
                  상용로그입니다. <code>sqrt(x)</code>, <code>exp(x)</code>,{' '}
                  <code>sin(x)</code> 등도 사용할 수 있습니다. 로그·제곱근의
                  정의역에 맞게 구간과 시작값을 정하세요.
                </p>
              </div>
            </section>
          )}

          <section className="guide-section">
            <span className="guide-step">{nonlinear ? '04' : '03'}</span>
            <div>
              <h3>슬라이더로 질문하고, 그래프로 확인하세요</h3>
              <p>
                파라미터 값을 바꾸면 해가 다시 계산됩니다. 그래프는 선택한
                파라미터의 범위를 훑으며 해가 어떻게 달라지는지 보여줍니다.
              </p>
              <p className="guide-small">
                데이터 표와 CSV는 설정한 간격을 따릅니다. 예를 들어 0.2~0.8,
                간격 0.01이면 61행입니다. 그래프를 탐색하면 같은 데이터 행이
                선택되며, 곡선을 그리는 계산 지점은 별도로 유지합니다.
              </p>
              <p className="guide-small">
                최댓값은 항상 마지막 행에 포함하므로 마지막 구간만 짧을 수
                있습니다. 데이터가 2,000행을 넘으면 간격이나 범위를 조정하세요.
                이 시뮬레이션은 정상상태 파라미터 분석이며 시간에 따른 적분은
                아닙니다.
              </p>
              {nonlinear && (
                <p className="guide-small">
                  비선형 모델은 각 파라미터 값에서 찾은 근을 비교합니다.
                  다중근이 있을 때 같은 해의 가지를 계속 따라간다고 보장되지는
                  않습니다. 실패한 지점은 표에서 상태를 확인하고 구간이나 초기
                  추정값을 조정하세요.
                </p>
              )}
            </div>
          </section>

          <section className="guide-section">
            <span className="guide-step">{nonlinear ? '05' : '04'}</span>
            <div>
              <h3>조건수로 해의 민감도를 살펴보세요</h3>
              <p>
                해석 리포트에서 ∞-norm 또는 2-norm(SVD)을 선택할 수 있습니다.
                조건수가 클수록 입력의 작은 오차가 해에 크게 영향을 줄 수
                있습니다.
              </p>
              {nonlinear && (
                <p className="guide-small">
                  비선형 모델에서는 찾은 해 근처의 Jacobian 행렬로 계산한 국소
                  조건수입니다. 미지수가 하나면 0이 아닌 미분값의 행렬 조건수는
                  1이므로, 이것만으로 전체 구간의 안정성이나 수렴을 판단할 수
                  없습니다. 잔차와 식의 단위도 함께 확인하세요.
                </p>
              )}
              <p className="guide-small">
                초록 ‘안정’은 10⁴ 미만, 노랑 ‘민감’은 10⁴ 이상~10⁸ 미만, 주황
                ‘매우 민감’은 10⁸ 이상입니다. 참고 범위이므로 측정 오차와 단위도
                함께 확인하세요.
              </p>
              <p className="guide-small">
                2-norm은 다른 기준으로 민감도를 측정하는 도구이며, 선택한다고 해
                자체의 정밀도가 높아지는 것은 아닙니다. 자세한 계산 방식은
                리포트에서 확인할 수 있습니다.
              </p>
            </div>
          </section>

          <div className="guide-note">
            <Lightbulb size={19} />
            <div>
              <h4>
                {nonlinear
                  ? '찾은 근이 유일하다는 뜻은 아닙니다'
                  : '모델을 직접 구성하세요'}
              </h4>
              <p>
                {nonlinear
                  ? '작은 잔차는 해당 식을 잘 만족한다는 뜻입니다. 다른 근이나 물리적으로 타당한 해가 있는지 구간과 시작값을 바꾸어 확인하세요. 사용법을 익힐 수 있는 비선형 예제도 제공됩니다.'
                  : 'Linear는 빈 계산기로 시작합니다. 독립적인 방정식 수와 미지수 수를 맞추고, 조절할 상수는 파라미터로 추가하세요.'}{' '}
                <code>#</code> 뒤에는 메모를 적을 수 있습니다. Differential
                Equation Solver 등 다른 큰 카테고리는 추후 추가될 예정입니다.
              </p>
            </div>
          </div>
          <p className="guide-privacy">
            계산은 브라우저의 Web Worker와 WebAssembly에서 실행됩니다. 모델은
            외부 서버로 전송되지 않습니다.
          </p>
        </div>
        <footer className="guide-footer">
          <button onClick={onClose}>
            모델 만들러 가기 <ArrowRight size={16} />
          </button>
        </footer>
      </div>
    </div>
  )
}
