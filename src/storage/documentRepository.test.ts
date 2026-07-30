import { beforeEach, describe, expect, it } from 'vitest'
import { clearDatabaseForTests } from './database'
import {
  getActiveDocument,
  replaceActiveDocument,
} from './documentRepository'

describe('documentRepository', () => {
  beforeEach(async () => {
    await clearDatabaseForTests()
  })

  it('stores and restores a PDF Blob', async () => {
    const blob = new Blob(['stored pdf bytes'], { type: 'application/pdf' })

    await replaceActiveDocument({
      name: 'notes.pdf',
      source: 'local',
      mimeType: blob.type,
      size: blob.size,
      blob,
    })

    const restored = await getActiveDocument()

    expect(restored?.name).toBe('notes.pdf')
    expect(restored?.blob).toBeInstanceOf(Blob)
    expect(await restored?.blob.text()).toBe('stored pdf bytes')
  })
})
