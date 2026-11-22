export function requiresMfaStepUp(input: {
  currentLevel: unknown
  nextLevel: unknown
  jwtAssuranceLevel: unknown
}): boolean {
  const { currentLevel, nextLevel, jwtAssuranceLevel } = input

  // Only known and mutually consistent assurance claims are accepted.
  // Unknown SDK/server values must never weaken an irreversible action.
  if (
    (currentLevel !== 'aal1' && currentLevel !== 'aal2') ||
    (nextLevel !== 'aal1' && nextLevel !== 'aal2') ||
    jwtAssuranceLevel !== currentLevel
  ) {
    return true
  }

  if (currentLevel === 'aal2') {
    return nextLevel !== 'aal2'
  }

  return nextLevel === 'aal2'
}
