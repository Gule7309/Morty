import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDatabaseForTests } from '../storage/database'
import { App } from './App'

vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
  Document: () => null,
  Page: () => null,
}))

describe('App empty and restoring states', () => {
  beforeEach(async () => {
    await clearDatabaseForTests()
  })

  it('shows a restoring state before displaying the empty import screen', async () => {
    render(<App />)

    expect(screen.getByText('正在恢復上次閱讀…')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'Pocket PDF' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '從裝置選擇 PDF' }),
    ).toBeInTheDocument()
  })
})
