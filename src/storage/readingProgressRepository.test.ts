import { beforeEach, describe, expect, it } from 'vitest'
import { clearDatabaseForTests } from './database'
import {
  getReadingProgress,
  saveReadingProgress,
} from './readingProgressRepository'

describe('readingProgressRepository', () => {
  beforeEach(async () => {
    await clearDatabaseForTests()
  })

  it('stores and restores the reading position and zoom', async () => {
    await saveReadingProgress({
      documentId: 'active-document',
      pageIndex: 18,
      pageOffset: 72,
      zoom: 1.25,
      updatedAt: 123,
    })

    await expect(getReadingProgress('active-document')).resolves.toEqual({
      documentId: 'active-document',
      pageIndex: 18,
      pageOffset: 72,
      zoom: 1.25,
      updatedAt: 123,
    })
  })
})
