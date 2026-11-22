import assert from 'node:assert/strict'
import test from 'node:test'

import { requiresMfaStepUp } from '../lib/account-deletion-auth'

test('does not require MFA when the account has no additional factor', () => {
  assert.equal(
    requiresMfaStepUp({
      currentLevel: 'aal1',
      nextLevel: 'aal1',
      jwtAssuranceLevel: 'aal1',
    }),
    false,
  )
})

test('requires MFA when a verified factor is enrolled but not yet verified for this session', () => {
  assert.equal(
    requiresMfaStepUp({
      currentLevel: 'aal1',
      nextLevel: 'aal2',
      jwtAssuranceLevel: 'aal1',
    }),
    true,
  )
})

test('accepts a session only when both the assurance result and JWT claim are aal2', () => {
  assert.equal(
    requiresMfaStepUp({
      currentLevel: 'aal2',
      nextLevel: 'aal2',
      jwtAssuranceLevel: 'aal2',
    }),
    false,
  )
})

test('fails closed when the assurance result and signed JWT claim disagree', () => {
  assert.equal(
    requiresMfaStepUp({
      currentLevel: 'aal2',
      nextLevel: 'aal2',
      jwtAssuranceLevel: 'aal1',
    }),
    true,
  )
})

test('fails closed when current or next assurance level is missing', () => {
  assert.equal(
    requiresMfaStepUp({
      currentLevel: null,
      nextLevel: 'aal2',
      jwtAssuranceLevel: null,
    }),
    true,
  )
  assert.equal(
    requiresMfaStepUp({
      currentLevel: 'aal1',
      nextLevel: null,
      jwtAssuranceLevel: 'aal1',
    }),
    true,
  )
})

test('fails closed for an unknown future assurance level', () => {
  assert.equal(
    requiresMfaStepUp({
      currentLevel: 'aal3',
      nextLevel: 'aal3',
      jwtAssuranceLevel: 'aal3',
    }),
    true,
  )
})

test('fails closed when the next level contradicts the current aal2 state', () => {
  assert.equal(
    requiresMfaStepUp({
      currentLevel: 'aal2',
      nextLevel: 'aal1',
      jwtAssuranceLevel: 'aal2',
    }),
    true,
  )
})
