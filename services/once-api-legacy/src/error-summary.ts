/** Log diagnostic identifiers only; messages and payloads may contain credentials or personal data. */
export function safeErrorDetails(error: unknown) {
  const fields = error !== null && typeof error === 'object'
    ? error as Record<string, unknown> : {};
  const name = typeof fields.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(fields.name)
    ? fields.name : 'UnknownError';
  const code = typeof fields.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(fields.code)
    ? fields.code : undefined;
  return { errorName: name, errorCode: code };
}
