import { getDatabase, type StoredDocument } from './database'

export const ACTIVE_DOCUMENT_ID = 'active-document'

export interface SaveDocumentInput {
  name: string
  source: StoredDocument['source']
  sourceFileId?: string
  mimeType: string
  size: number
  blob: Blob
}

export async function replaceActiveDocument(
  input: SaveDocumentInput,
): Promise<StoredDocument> {
  const now = Date.now()
  const document: StoredDocument = {
    id: ACTIVE_DOCUMENT_ID,
    ...input,
    createdAt: now,
    lastOpenedAt: now,
  }
  const database = await getDatabase()
  const transaction = database.transaction(
    ['documents', 'readingProgress'],
    'readwrite',
  )

  await Promise.all([
    transaction.objectStore('documents').put(document),
    transaction.objectStore('readingProgress').delete(ACTIVE_DOCUMENT_ID),
    transaction.done,
  ])

  return document
}

export async function getActiveDocument(): Promise<
  StoredDocument | undefined
> {
  const database = await getDatabase()
  const document = await database.get('documents', ACTIVE_DOCUMENT_ID)

  if (document) {
    document.lastOpenedAt = Date.now()
    await database.put('documents', document)
  }

  return document
}

export async function deleteActiveDocument(): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['documents', 'readingProgress'],
    'readwrite',
  )

  await Promise.all([
    transaction.objectStore('documents').delete(ACTIVE_DOCUMENT_ID),
    transaction.objectStore('readingProgress').delete(ACTIVE_DOCUMENT_ID),
    transaction.done,
  ])
}
