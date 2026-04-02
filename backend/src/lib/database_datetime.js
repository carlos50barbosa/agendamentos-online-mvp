const MYSQL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function toDatabaseDateTime(value) {
  if (value == null || value === '') return null

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error('invalid_database_datetime')
    }
    return value.toISOString().slice(0, 19).replace('T', ' ')
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (MYSQL_DATETIME_PATTERN.test(trimmed)) return trimmed
  }

  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('invalid_database_datetime')
  }
  return parsed.toISOString().slice(0, 19).replace('T', ' ')
}

