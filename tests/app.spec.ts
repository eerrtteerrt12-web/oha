import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function ready(page: Page) {
  await expect(page.locator('.engine-status')).toHaveText(/WebAssembly/)
  await expect(page.locator('.result-footer')).toContainText('계산 완료')
}
async function openExample(page: Page, name: string) {
  await page.getByRole('button', { name: '예제 불러오기' }).click()
  await page
    .locator('.examples-menu')
    .getByRole('button', { name: new RegExp(name) })
    .click()
  await ready(page)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await ready(page)
})

test('WebAssembly solves mixing model and parameter slider updates live', async ({
  page,
}) => {
  await expect(page.locator('.solution-value strong')).toHaveText(['50', '50'])
  await page.getByRole('slider', { name: 'c_T 슬라이더' }).fill('0.6')
  await expect(page.locator('.solution-value strong').nth(0)).toHaveText(
    '33.33333',
  )
  await expect(page.locator('.solution-value strong').nth(1)).toHaveText(
    '66.66667',
  )
  await ready(page)
})

test('nonlinear models show errors and corrected equations recover', async ({
  page,
}) => {
  await page
    .getByRole('textbox', { name: '방정식 입력' })
    .fill('x + y = 10\nx*y = 20')
  await expect(page.getByRole('alert')).toContainText(
    '미지수끼리의 곱은 선형식이 아닙니다',
  )
  await page
    .getByRole('textbox', { name: '방정식 입력' })
    .fill('x + y = 10\nx - y = 2')
  await ready(page)
  await expect(page.locator('.solution-value strong')).toHaveText(['6', '4'])
})

test('example switching solves standard shorthand and three-variable systems', async ({
  page,
}) => {
  await openExample(page, '처음 만나는 연립방정식')
  await expect(page.locator('.solution-value strong')).toHaveText([
    '1.928571',
    '2.714286',
  ])
  await expect(page.getByText('상수에 움직임을 더해 보세요.')).toBeVisible()
  await openExample(page, '세 미지수의 균형')
  await expect(page.locator('.solution-value strong')).toHaveText([
    '3',
    '4',
    '5',
  ])
})

test('graph exploration and legend are connected to data table', async ({
  page,
}) => {
  const chart = page.getByRole('img', { name: /c_T에 따른 선형 방정식/ })
  await chart.focus()
  await chart.press('Home')
  await expect(
    page.locator('.sweep-table tr[aria-selected=true] td'),
  ).toHaveText(['0.2', '100', '0'])
  await chart.press('End')
  await expect(
    page.locator('.sweep-table tr[aria-selected=true] td'),
  ).toHaveText(['0.8', '0', '100'])
  const tablePoint = page.getByRole('row', {
    name: 'c_T 0.35 탐색',
    exact: true,
  })
  await tablePoint.hover()
  await expect(tablePoint).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.sc-tooltip-heading strong')).toHaveText('0.35')
  await tablePoint.focus()
  await tablePoint.press('ArrowDown')
  await expect(page.locator('.sc-tooltip-heading strong')).toHaveText('0.3575')
  await page.getByRole('button', { name: 'x 곡선 표시' }).click()
  await expect(
    page.getByRole('button', { name: 'x 곡선 표시' }),
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.sc-curve')).toHaveCount(1)
})

test('matrix, report and exports reflect current results', async ({ page }) => {
  await page.getByRole('button', { name: '행렬 보기' }).click()
  await expect(page.locator('.matrix-equation')).toContainText('100')
  const csv = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV', exact: true }).click()
  const csvDownload = await csv
  expect(csvDownload.suggestedFilename()).toBe('polymath-data.csv')
  const csvText = await readFile((await csvDownload.path())!, 'utf8')
  expect(csvText.replace(/^\uFEFF/, '').split('\n')[0]).toBe('c_T,x,y')
  expect(csvText.trim().split('\n')).toHaveLength(82)
  await page.getByRole('button', { name: '해석 리포트' }).click()
  await expect(page.locator('.report-metrics')).toContainText('최대 절대 잔차')
  const report = page.waitForEvent('download')
  await page.getByRole('button', { name: '리포트 저장' }).click()
  const reportDownload = await report
  expect(reportDownload.suggestedFilename()).toBe('polymath-report.md')
  const reportText = await readFile((await reportDownload.path())!, 'utf8')
  expect(reportText).toContain('| x | 50.0000000000 |')
  expect(reportText).toContain('계산 엔진: wasm')
  const saved = page.waitForEvent('download')
  await page.getByRole('button', { name: '프로젝트 저장' }).click()
  const projectDownload = await saved
  expect(projectDownload.suggestedFilename()).toBe('polymath-project.json')
  const projectFile = JSON.parse(
    await readFile((await projectDownload.path())!, 'utf8'),
  )
  expect(
    projectFile.parameters.find((p: { name: string }) => p.name === 'c_T')
      .value,
  ).toBe(0.5)
})

test('local project persists on reload and guide opens accessibly', async ({
  page,
}) => {
  await page
    .getByRole('textbox', { name: '모델 이름' })
    .fill('브라우저 저장 테스트')
  await page.getByRole('slider', { name: 'F 슬라이더' }).fill('120')
  await expect(page.locator('.solution-value strong')).toHaveText(['60', '60'])
  await page.reload()
  await ready(page)
  await expect(page.getByRole('textbox', { name: '모델 이름' })).toHaveValue(
    '브라우저 저장 테스트',
  )
  await expect(page.locator('.solution-value strong')).toHaveText(['60', '60'])
  await page
    .getByRole('button', { name: '사용 가이드', exact: true })
    .first()
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('desktop and mobile render without horizontal overflow', async ({
  page,
}) => {
  await page.screenshot({ path: '/tmp/polymath-desktop.png', fullPage: true })
  const desktopOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(desktopOverflow).toBe(false)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/polymath-mobile.png', fullPage: true })
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(mobileOverflow).toBe(false)
  await expect(page.getByRole('button', { name: '모델 풀기' })).toBeVisible()
})

test('project import restores a custom model and rejects malformed data', async ({
  page,
}) => {
  const input = page.locator('input[type=file]')
  await input.setInputFiles({
    name: 'custom.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        title: '사용자 모델',
        description: '가져온 모델',
        source: '3x = F',
        parameters: [
          { id: 'F', name: 'F', value: 12, min: 0, max: 24, step: 1 },
        ],
        sweepName: 'F',
      }),
    ),
  })
  await expect(page.getByRole('textbox', { name: '모델 이름' })).toHaveValue(
    '사용자 모델',
  )
  await expect(page.locator('.solution-value strong')).toHaveText(['4'])
  await page.getByRole('slider', { name: 'F 슬라이더' }).fill('6')
  await expect(page.locator('.solution-value strong')).toHaveText(['2'])
  await input.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"title": false}'),
  })
  await expect(page.getByRole('status')).toContainText(
    '올바른 Polymath 프로젝트 JSON 파일이 아닙니다',
  )
  await expect(page.locator('.solution-value strong')).toHaveText(['2'])
})

test('parameters can be added, bounded, adjusted and deleted', async ({
  page,
}) => {
  await openExample(page, '처음 만나는 연립방정식')
  await page.getByRole('button', { name: '파라미터 추가', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('이름', { exact: true }).fill('k')
  await dialog.getByLabel('현재 값', { exact: true }).fill('2')
  await dialog
    .getByRole('button', { name: '파라미터 추가', exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('textbox', { name: '방정식 입력' }).fill('k*x = 10')
  await expect(page.locator('.solution-value strong')).toHaveText(['5'])
  await page
    .getByRole('button', { name: '파라미터 범위 설정', exact: true })
    .click()
  await page
    .getByRole('spinbutton', { name: 'k 최솟값', exact: true })
    .fill('1')
  await page
    .getByRole('spinbutton', { name: 'k 최댓값', exact: true })
    .fill('4')
  await page
    .getByRole('spinbutton', { name: 'k 간격', exact: true })
    .fill('0.5')
  await page.getByRole('button', { name: 'k 범위 적용', exact: true }).click()
  const slider = page.getByRole('slider', { name: 'k 슬라이더', exact: true })
  await expect(slider).toHaveAttribute('min', '1')
  await expect(slider).toHaveAttribute('step', '0.5')
  await slider.fill('4')
  await expect(page.locator('.solution-value strong')).toHaveText(['2.5'])
  await page.getByRole('button', { name: 'k 삭제', exact: true }).click()
  await expect(slider).not.toBeVisible()
  await expect(page.getByRole('alert')).toContainText(
    '미지수 2개가 일치해야 합니다',
  )
})

test('dependent and inconsistent systems provide distinct diagnostics', async ({
  page,
}) => {
  const editor = page.getByRole('textbox', { name: '방정식 입력' })
  await editor.fill('x + y = 4\n2x + 2y = 8')
  await expect(page.getByRole('alert')).toContainText(
    '독립적인 수식이 부족하거나',
  )
  await editor.fill('x + y = 4\n2x + 2y = 9')
  await expect(page.getByRole('alert')).toContainText(
    '서로 모순되는 수식으로 해가 없습니다',
  )
  await editor.fill('x + y = 4\nx - y = 2')
  await ready(page)
  await expect(page.locator('.solution-value strong')).toHaveText(['3', '1'])
})
