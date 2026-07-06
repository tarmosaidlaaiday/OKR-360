export function getErrorMessage(ex: unknown): string {
  if (ex instanceof Error) return ex.message
  if (typeof ex === 'object' && ex !== null && 'message' in ex) {
    const msg = (ex as { message: unknown }).message
    if (typeof msg === 'string' && msg.length > 0) return msg
  }
  if (typeof ex === 'string') return ex
  return 'Something went wrong'
}
