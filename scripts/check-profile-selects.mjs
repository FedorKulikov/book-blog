#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOTS = ['app', 'lib', 'scripts', 'tests']
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const failures = []

function collectFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true })
  const result = []

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...collectFiles(fullPath))
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      result.push(fullPath)
    }
  }

  return result
}

function stringValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return null
}

function isProfilesQueryReceiver(node) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'from' &&
      stringValue(node.arguments[0]) === 'profiles'
    ) {
      return true
    }
    return isProfilesQueryReceiver(callee)
  }

  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return isProfilesQueryReceiver(node.expression)
  }

  return false
}

function selectsAllColumns(value) {
  // A top-level wildcard expands profiles.*, including restricted columns.
  // Ignore nested relation selectors such as "posts(*)" on another table.
  return /(^|,)\\s*\\*(?=\\s*(,|$))/.test(value.trim())
}

const existingEntries = new Set(readdirSync('.'))
for (const root of ROOTS) {
  if (!existingEntries.has(root)) {
    failures.push(`Missing source directory: ${root}`)
    continue
  }

  for (const file of collectFiles(root)) {
    const sourceText = readFileSync(file, 'utf8')
    const extension = path.extname(file)
    const scriptKind =
      extension === '.tsx' ? ts.ScriptKind.TSX :
      extension === '.jsx' ? ts.ScriptKind.JSX :
      extension === '.js' || extension === '.mjs' || extension === '.cjs'
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    )

    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'select' &&
        isProfilesQueryReceiver(node.expression.expression)
      ) {
        const selector = stringValue(node.arguments[0])
        if (selector !== null && selectsAllColumns(selector)) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          failures.push(
            `${file}:${position.line + 1}:${position.character + 1} selects all profiles columns`,
          )
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`)
  console.error('Do not use wildcard SELECT on public.profiles; list permitted columns explicitly.')
  process.exit(1)
}

console.log('PASS: no wildcard SELECT found on public.profiles in app/, lib/, scripts/, or tests/.')
