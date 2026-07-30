import { useRef } from 'react'
import { validateLocalPdf } from './pdfValidation'

interface LocalPdfPickerProps {
  busy?: boolean
  onError: (message: string) => void
  onSelect: (file: File) => Promise<void>
}

export function LocalPdfPicker({
  busy = false,
  onError,
  onSelect,
}: LocalPdfPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const validationError = validateLocalPdf(file)
    if (validationError) {
      onError(validationError)
      return
    }

    await onSelect(file)
  }

  return (
    <>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="application/pdf,.pdf"
        disabled={busy}
        onChange={(event) => void handleChange(event)}
      />
      <button
        className="primaryButton"
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <span aria-hidden="true">＋</span>
        從裝置選擇 PDF
      </button>
    </>
  )
}
