import { badRequest } from './errors'

/** 驗證非空字串，失敗時 throw AppError(400) */
export const requireString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${label}為必填`)
  }
  return value.trim()
}

/** 驗證數字，失敗時 throw AppError(400) */
export const requireNumber = (value: unknown, label: string): number => {
  const num = Number(value)
  if (isNaN(num)) {
    throw badRequest(`${label}必須為數字`)
  }
  return num
}

/** 驗證非空陣列，失敗時 throw AppError(400) */
export const requireArray = <T>(value: unknown, label: string): T[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest(`${label}為必填`)
  }
  return value as T[]
}
