import {
  getDatabase,
  type ReadingProgress,
} from './database'

export async function saveReadingProgress(
  progress: ReadingProgress,
): Promise<void> {
  const database = await getDatabase()
  await database.put('readingProgress', progress)
}

export async function getReadingProgress(
  documentId: string,
): Promise<ReadingProgress | undefined> {
  const database = await getDatabase()
  return database.get('readingProgress', documentId)
}
