import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

export const DATABASE_NAME = 'pocket-pdf'
const DATABASE_VERSION = 1

export interface StoredDocument {
  id: string
  name: string
  source: 'local' | 'google-drive' | 'pocket-pdf'
  sourceFileId?: string
  cloudDocumentId?: string
  mimeType: string
  size: number
  blob: Blob
  createdAt: number
  lastOpenedAt: number
}

export interface ReadingProgress {
  documentId: string
  pageIndex: number
  pageOffset: number
  zoom: number
  updatedAt: number
}

interface PocketPdfDatabase extends DBSchema {
  documents: {
    key: string
    value: StoredDocument
  }
  readingProgress: {
    key: string
    value: ReadingProgress
  }
}

let databasePromise: Promise<IDBPDatabase<PocketPdfDatabase>> | undefined

export function getDatabase(): Promise<IDBPDatabase<PocketPdfDatabase>> {
  databasePromise ??= openDB<PocketPdfDatabase>(
    DATABASE_NAME,
    DATABASE_VERSION,
    {
      upgrade(database) {
        if (!database.objectStoreNames.contains('documents')) {
          database.createObjectStore('documents', { keyPath: 'id' })
        }

        if (!database.objectStoreNames.contains('readingProgress')) {
          database.createObjectStore('readingProgress', {
            keyPath: 'documentId',
          })
        }
      },
    },
  )

  return databasePromise
}

export async function clearDatabaseForTests(): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['documents', 'readingProgress'],
    'readwrite',
  )
  await Promise.all([
    transaction.objectStore('documents').clear(),
    transaction.objectStore('readingProgress').clear(),
    transaction.done,
  ])
}
