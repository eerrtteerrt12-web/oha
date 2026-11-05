import { useEffect, useRef } from 'react'
import { ArrowRight, BookOpen, Check, Lightbulb, X } from 'lucide-react'
import './Guide.css'

export default function Guide({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null)

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
          <p className="guide-eyebrow">A SMALL GUIDE TO BIG IDEAS</p>
          <h2 id="guide-title">수식을 쓰는 것부터 시작하세요.</h2>
          <p>복잡한 코딩 없이, 익숙한 수학 문법으로 모델을 만듭니다.</p>
        </header>

        <div className="guide-content">
          <section className="guide-section">
            <span className="guide-step">01</span>
            <div>
              <h3>한 줄에 방정식 하나</h3>
              <p>
                모르는 값은 문자로, 알고 있는 값은 숫자로 적으세요. 양쪽 모두에
                미지수가 있어도 괜찮습니다.
              </p>
              <pre className="guide-code">
                <span># 두 식, 두 미지수</span>
                {'\n'}2x + 3y = 12{'\n'}4x = 5 + y
              </pre>
              <div className="guide-rule">
                <Check size={14} />
                <span>
                  <code>2x</code>와 <code>2*x</code>는 같은 뜻입니다.
                </span>
              </div>
              <p className="guide-small">
                더 편하게 쓸 수 있도록 <code>2*(x + y)</code> 같은 괄호와{' '}
                <code>x/2</code>처럼 알려진 값으로 나누기도 지원합니다.
              </p>
            </div>
          </section>

          <section className="guide-section">
            <span className="guide-step">02</span>
            <div>
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
            </div>
          </section>

          <section className="guide-section">
            <span className="guide-step">03</span>
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
            </div>
          </section>

          <section className="guide-section">
            <span className="guide-step">04</span>
            <div>
              <h3>조건수로 해의 민감도를 살펴보세요</h3>
              <p>
                해석 리포트에서 ∞-norm 또는 2-norm(SVD)을 선택할 수 있습니다.
                조건수가 클수록 입력의 작은 오차가 해에 크게 영향을 줄 수
                있습니다.
              </p>
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
              <h4>이번 버전은 선형 방정식에 집중합니다</h4>
              <p>
                미지수끼리의 곱 <code>x*y</code>, <code>x^2</code>,{' '}
                <code>sin(x)</code> 같은 비선형 식은 지원하지 않습니다. 독립적인
                방정식 수와 미지수 수를 맞춰주세요. <code>#</code> 뒤에는
                자유롭게 메모할 수 있습니다.
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
