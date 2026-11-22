export type AssuranceLevel = string | null | undefined

export function requiresMfaStepUp(input: {
  currentLevel: AssuranceLevel
  nextLevel: AssuranceLevel
  jwtAssuranceLevel: AssuranceLevel
}): boolean {
  return (
    input.nextLevel === 'aal2' &&
    (input.currentLevel !== 'aal2' || input.jwtAssuranceLevel !== 'aal2')
  )
}
