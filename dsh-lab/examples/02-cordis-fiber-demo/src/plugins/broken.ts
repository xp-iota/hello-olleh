export const name = 'broken'

export function apply() {
  throw new Error('装配期故意失败')
}