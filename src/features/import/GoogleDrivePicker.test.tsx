import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDatabaseForTests, getDatabase } from '../../storage/database'
import { GoogleDrivePicker } from './GoogleDrivePicker'

interface MockDrivePickerProps {
  children?: ReactNode
  onOauthResponse?: (event: {
    detail: { access_token: string }
  }) => void
}

vi.mock('@googleworkspace/drive-picker-react', () => ({
  DrivePicker: ({ children, onOauthResponse }: MockDrivePickerProps) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onOauthResponse?.({ detail: { access_token: 'secret-token' } })
        }
      >
        模擬 OAuth
      </button>
      {children}
    </div>
  ),
  DrivePickerDocsView: () => null,
}))

describe('GoogleDrivePicker', () => {
  beforeEach(async () => {
    await clearDatabaseForTests()
  })

  it('disables Drive import when credentials are missing', () => {
    render(
      <GoogleDrivePicker
        clientId=""
        appId=""
        onError={vi.fn()}
        onImport={vi.fn()}
        onStatus={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: '從 Google Drive 選擇' }),
    ).toBeDisabled()
    expect(screen.getByText('Google Drive 尚未設定')).toBeInTheDocument()
  })

  it('keeps the OAuth token out of browser persistence', async () => {
    render(
      <GoogleDrivePicker
        clientId="client-id"
        appId="app-id"
        onError={vi.fn()}
        onImport={vi.fn()}
        onStatus={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '模擬 OAuth' }))

    const database = await getDatabase()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    await expect(database.getAll('documents')).resolves.toEqual([])
    await expect(database.getAll('readingProgress')).resolves.toEqual([])
  })
})
