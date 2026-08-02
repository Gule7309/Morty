import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StorageUsage } from '../../services/cloudStorage'
import { StorageUsageCard } from './StorageUsageCard'

function usage(ratio: number): StorageUsage {
  return {
    documents: { used: 37, reserved: 1, limit: 100 },
    storage: {
      usedBytes: 812_000_000,
      reservedBytes: 24_000_000,
      limitBytes: 2_000_000_000,
      remainingBytes: 1_164_000_000,
      usageRatio: ratio,
    },
    warning: ratio >= 0.8,
    canUpload: ratio < 1,
  }
}

describe('StorageUsageCard', () => {
  it('renders API quota values and reserved documents', () => {
    render(<StorageUsageCard usage={usage(0.418)} />)

    expect(screen.getByText('812 MB / 2 GB')).toBeInTheDocument()
    expect(screen.getByText('38 / 100')).toBeInTheDocument()
    expect(screen.getByText('空間充足')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: '雲端儲存空間使用量' }),
    ).toHaveAttribute('aria-valuenow', '42')
  })

  it('uses text as well as color for the 80 percent warning', () => {
    render(<StorageUsageCard usage={usage(0.8)} />)

    expect(screen.getByText('空間即將用完')).toBeInTheDocument()
    expect(
      screen.getByText(
        '你的雲端空間即將用完，建議刪除不需要的文件。',
      ),
    ).toBeInTheDocument()
  })

  it('shows an explicit full state at 100 percent', () => {
    render(<StorageUsageCard usage={usage(1)} />)

    expect(screen.getByText('空間已滿')).toBeInTheDocument()
    expect(
      screen.getByText(
        '雲端空間已滿；你仍可閱讀或刪除文件，但暫時不能新增上傳。',
      ),
    ).toBeInTheDocument()
  })
})

