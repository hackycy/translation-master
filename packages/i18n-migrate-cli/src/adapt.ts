import type { AdaptConfig, AdaptOptions, AdaptResult, AdaptSkip, TextSegment, TranslationEntry } from './types'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parse as babelParse } from '@babel/parser'
import { parse as parseVue } from '@vue/compiler-sfc'
import { createMapAdaptMeta, hasReadyAdaptEntries, isMapAdapted } from './adapt-status'
import { backupFile } from './backup'
import { loadConfig } from './config'
import { Extractor } from './extractor'
import { paramNameForExpression } from './keygen'
import { findMapPaths } from './map-paths'
import { readMapFile, writeMapFile } from './mapping'
import { mapPathToSourcePath, toPosixPath } from './paths'
import { createUnifiedDiff } from './reporter'

interface AdaptReplacement {
  start: number
  end: number
  text: string
  order?: number
}

interface AdaptFileResult {
  content: string
  applied: number
  skipped: AdaptSkip[]
}

interface AdaptWorkItem {
  sourcePath: string
  mapFile: Awaited<ReturnType<typeof readMapFile>>
}

interface AdaptParam {
  name: string
  expression: string
}

interface ScriptRuntimePlan {
  replacements: AdaptReplacement[]
  vueScriptSetup?: VueSetupRuntime
  vueScript?: VueScriptRuntime
  moduleScript?: ModuleScriptRuntime
}

interface VueSetupRuntime {
  block: ScriptBlockInfo
  callee: string
  useI18nCallee: string
  hasUseI18nBinding: boolean
  bindingInserted: boolean
  importInserted: boolean
}

interface VueScriptRuntime {
  block: ScriptBlockInfo
  setupScopes: SetupScope[]
  thisScopes: Array<{ start: number, end: number }>
  useI18nCallee: string
  importInserted: boolean
}

interface ModuleScriptRuntime {
  block: ScriptBlockInfo
  callee: string
  importInserted: boolean
  shouldInjectImport: boolean
  importConfig?: RuntimeImport
}

interface ScriptBlockInfo {
  content: string
  start: number
  end: number
  filePath: string
  ast?: BabelNode
  imports: ImportInfo[]
  bindings: Set<string>
}

interface SetupScope {
  start: number
  end: number
  bodyStart: number
  contentStart: number
  contentEnd: number
  callee: string
  hasUseI18nBinding: boolean
  bindingInserted: boolean
}

interface ImportInfo {
  start: number
  end: number
  source: string
  specifiers: Array<{ imported?: string, local: string }>
}

interface RuntimeImport {
  source: string
  named: string
  local: string
}

interface BabelNode {
  type: string
  start?: number | null
  end?: number | null
  body?: unknown
  declarations?: unknown[]
  id?: unknown
  key?: unknown
  value?: unknown
  source?: { value?: unknown }
  specifiers?: unknown[]
  imported?: unknown
  local?: unknown
  name?: unknown
  params?: unknown[]
  properties?: unknown[]
  expression?: unknown
  callee?: unknown
  object?: unknown
  property?: unknown
  computed?: boolean
  init?: unknown
  program?: unknown
  arguments?: unknown[]
  declaration?: unknown
}

export async function adaptSources(options: AdaptOptions = {}): Promise<AdaptResult> {
  const cwd = options.cwd ?? process.cwd()
  options.onProgress?.({ phase: 'prepare', message: options.dryRun ? 'Preparing i18n adapt preview' : 'Preparing i18n source adaptation' })
  const config = await loadConfig(cwd)
  const extractor = new Extractor(config)
  const workItems = await findAdaptWorkItems(cwd, options.path, options.all === true)
  const batchId = new Date().toISOString()
  const files: AdaptResult['files'] = []
  const allSkipped: AdaptSkip[] = []
  options.onProgress?.({ phase: 'discover', message: `Found ${workItems.length} pending source file(s) for adapt`, total: workItems.length })

  for (const [index, workItem] of workItems.entries()) {
    const { sourcePath, mapFile } = workItem
    options.onProgress?.({
      phase: 'file',
      path: sourcePath,
      current: index + 1,
      total: workItems.length,
      action: 'adapt',
      dryRun: options.dryRun,
    })

    const absolutePath = path.join(cwd, sourcePath)
    const content = await readFile(absolutePath, 'utf8')
    const translations = new Map<string, TranslationEntry>(Object.entries(mapFile.entries))
    const segments = extractor.extract(content, sourcePath)
    const adapted = adaptContent(content, sourcePath, segments, translations, config.adapt)
    const changed = adapted.content !== content

    if (changed && !options.dryRun) {
      await backupFile(cwd, sourcePath, batchId)
      await writeFile(absolutePath, adapted.content, 'utf8')
      options.onProgress?.({ phase: 'write', path: sourcePath, current: index + 1, total: workItems.length, action: 'adapt' })
    }

    if (!options.dryRun) {
      await writeMapFile(cwd, sourcePath, {
        ...mapFile,
        adapt: createMapAdaptMeta(mapFile, {
          applied: adapted.applied,
          skipped: adapted.skipped.length,
          changed,
        }),
      })
    }

    allSkipped.push(...adapted.skipped)
    files.push({
      sourcePath,
      changed,
      applied: adapted.applied,
      skipped: adapted.skipped,
      diff: options.dryRun ? createUnifiedDiff(sourcePath, content, adapted.content) : undefined,
    })
  }

  options.onProgress?.({ phase: 'done', message: 'Adapt finished' })
  return { files, dryRun: options.dryRun === true, skipped: allSkipped }
}

async function findAdaptWorkItems(cwd: string, targetPath: string | undefined, includeAll: boolean): Promise<AdaptWorkItem[]> {
  const mapPaths = await findMapPaths(cwd, targetPath)
  const workItems: AdaptWorkItem[] = []

  for (const mapPath of mapPaths) {
    const sourcePath = mapPathToSourcePath(mapPath)
    const mapFile = await readMapFile(cwd, sourcePath)
    if (!hasReadyAdaptEntries(mapFile))
      continue
    if (isMapAdapted(mapFile))
      continue

    workItems.push({ sourcePath, mapFile })
  }

  return includeAll ? workItems : workItems.slice(0, 1)
}

export function adaptContent(
  content: string,
  sourcePath: string,
  segments: TextSegment[],
  translations: Map<string, TranslationEntry>,
  config: AdaptConfig,
): AdaptFileResult {
  const runtimePlan = createScriptRuntimePlan(content, sourcePath, config)
  const replacements: AdaptReplacement[] = runtimePlan.replacements
  const skipped: AdaptSkip[] = []
  let applied = 0

  for (const segment of segments) {
    const entry = translations.get(segment.text)
    const ready = entry && entry.approved && (entry.translationApproved ?? true) && (entry.keyApproved ?? true) && !entry.skip && !entry.deprecated
    if (!ready)
      continue

    if (!entry.key) {
      skipped.push(skip(sourcePath, segment.text, undefined, 'missing-key', 'Approve or assign an i18n key in the map file.'))
      continue
    }

    const replacement = replacementForSegment(content, sourcePath, segment, entry, config, runtimePlan)
    if (!replacement) {
      skipped.push(skip(sourcePath, segment.text, entry.key, 'unsupported-context', 'Rewrite this occurrence manually or adjust adapt configuration.'))
      continue
    }

    replacements.push(replacement)
    applied += 1
  }

  let next = content
  for (const replacement of replacements.sort((left, right) => right.start - left.start || (right.order ?? 0) - (left.order ?? 0)))
    next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`

  return {
    content: next,
    applied,
    skipped,
  }
}

function replacementForSegment(
  content: string,
  sourcePath: string,
  segment: TextSegment,
  entry: TranslationEntry,
  config: AdaptConfig,
  runtimePlan: ScriptRuntimePlan,
): AdaptReplacement | undefined {
  const key = keyReference(sourcePath, entry.key!, config)
  const params = paramsForSegment(segment)

  if (sourcePath.endsWith('.vue') && segment.context === 'template' && segment.nodeType === 'VueTemplateText') {
    return {
      start: segment.start,
      end: segment.end,
      text: `{{ ${callExpression(config.callee.vue, key, params)} }}`,
    }
  }

  if (sourcePath.endsWith('.vue') && segment.context === 'html-attr' && segment.nodeType === 'VueStaticAttribute') {
    const attr = staticAttributeRange(content, segment)
    return attr
      ? {
          start: attr.start,
          end: attr.end,
          text: `:${attr.name}="${callExpression(config.callee.vue, key, params)}"`,
        }
      : undefined
  }

  if (sourcePath.endsWith('.vue') && segment.context === 'template' && segment.nodeType === 'VueDirectiveStringLiteral') {
    return scriptStringReplacement(content, segment, callExpression(config.callee.vue, key, params))
  }

  if (segment.context === 'script' && segment.nodeType === 'StringLiteral') {
    const callee = scriptCalleeForSegment(content, segment, runtimePlan, config)
    if (!callee)
      return undefined

    const replacement = scriptStringReplacement(content, segment, callExpression(callee, key, params))
    return replacement
  }

  if (segment.context === 'script' && segment.nodeType === 'JSXStringLiteral') {
    const callee = scriptCalleeForSegment(content, segment, runtimePlan, config)
    if (!callee)
      return undefined

    return jsxAttributeStringReplacement(content, segment, callExpression(callee, key, params))
  }

  if (segment.context === 'script' && segment.nodeType === 'JSXText') {
    const callee = scriptCalleeForSegment(content, segment, runtimePlan, config)
    if (!callee)
      return undefined

    return {
      start: segment.start,
      end: segment.end,
      text: `{${callExpression(callee, key, params)}}`,
    }
  }

  if (segment.context === 'script' && segment.nodeType === 'TemplateElement') {
    const callee = scriptCalleeForSegment(content, segment, runtimePlan, config)
    if (!callee)
      return undefined

    return scriptTemplateElementReplacement(content, segment, callExpression(callee, key, params))
  }

  return undefined
}

function scriptStringReplacement(content: string, segment: TextSegment, expression: string): AdaptReplacement | undefined {
  const quote = content[segment.start - 1]
  const after = content[segment.end]
  if (!quote || quote !== after || (quote !== '\'' && quote !== '"'))
    return undefined

  return {
    start: segment.start - 1,
    end: segment.end + 1,
    text: expression,
  }
}

function jsxAttributeStringReplacement(content: string, segment: TextSegment, expression: string): AdaptReplacement | undefined {
  const quote = content[segment.start - 1]
  const after = content[segment.end]
  if (!quote || quote !== after || (quote !== '\'' && quote !== '"'))
    return undefined

  return {
    start: segment.start - 1,
    end: segment.end + 1,
    text: `{${expression}}`,
  }
}

function scriptTemplateElementReplacement(content: string, segment: TextSegment, expression: string): AdaptReplacement | undefined {
  const before = content[segment.start - 1]
  const after = content[segment.end]
  if (before !== '`' || after !== '`')
    return undefined

  return {
    start: segment.start - 1,
    end: segment.end + 1,
    text: expression,
  }
}

function createScriptRuntimePlan(content: string, sourcePath: string, config: AdaptConfig): ScriptRuntimePlan {
  if (sourcePath.endsWith('.vue'))
    return createVueScriptRuntimePlan(content, sourcePath, config)

  if (isScriptPath(sourcePath))
    return createModuleScriptRuntimePlan(content, sourcePath, config)

  return { replacements: [] }
}

function createVueScriptRuntimePlan(content: string, sourcePath: string, config: AdaptConfig): ScriptRuntimePlan {
  const descriptor = parseVue(content, { sourceMap: true }).descriptor
  const replacements: AdaptReplacement[] = []
  const plan: ScriptRuntimePlan = { replacements }

  if (descriptor.scriptSetup) {
    const block = createScriptBlockInfo(
      descriptor.scriptSetup.content,
      descriptor.scriptSetup.loc.start.offset,
      scriptBlockPath(sourcePath, descriptor.scriptSetup.lang),
    )
    const useI18nCallee = resolveUseI18nCallee(block, config)
    const existingBinding = findUseI18nBinding(block, useI18nCallee, config.callee.script)
    const callee = existingBinding ?? uniqueIdentifier(config.callee.script, block.bindings)
    const runtime: VueSetupRuntime = {
      block,
      callee,
      useI18nCallee,
      hasUseI18nBinding: Boolean(existingBinding),
      bindingInserted: false,
      importInserted: false,
    }

    plan.vueScriptSetup = runtime
  }

  if (descriptor.script) {
    const block = createScriptBlockInfo(
      descriptor.script.content,
      descriptor.script.loc.start.offset,
      scriptBlockPath(sourcePath, descriptor.script.lang),
    )
    const useI18nCallee = resolveUseI18nCallee(block, config)
    const runtime: VueScriptRuntime = {
      block,
      setupScopes: createSetupScopes(block, useI18nCallee, config),
      thisScopes: createOptionsThisScopes(block),
      useI18nCallee,
      importInserted: false,
    }

    plan.vueScript = runtime
  }

  return plan
}

function createModuleScriptRuntimePlan(content: string, sourcePath: string, config: AdaptConfig): ScriptRuntimePlan {
  const replacements: AdaptReplacement[] = []
  const block = createScriptBlockInfo(content, 0, sourcePath)
  const importConfig = scriptRuntimeImport(config)
  const local = importConfig?.local ?? config.callee.script
  const existingImport = importConfig
    ? findNamedImportLocal(block, importConfig.source, importConfig.named)
    : undefined
  const hasExistingRuntime = block.bindings.has(local)
  const callee = existingImport ?? local
  if (!importConfig && !hasExistingRuntime) {
    return {
      replacements,
    }
  }

  const runtime: ModuleScriptRuntime = {
    block,
    callee,
    importConfig,
    importInserted: false,
    shouldInjectImport: Boolean(importConfig && !existingImport),
  }

  return {
    replacements,
    moduleScript: runtime,
  }
}

function scriptCalleeForSegment(
  content: string,
  segment: TextSegment,
  runtimePlan: ScriptRuntimePlan,
  config: AdaptConfig,
): string | undefined {
  if (runtimePlan.vueScriptSetup && contains(runtimePlan.vueScriptSetup.block, segment.start)) {
    ensureVueScriptSetupRuntime(runtimePlan.replacements, runtimePlan.vueScriptSetup, config)
    return runtimePlan.vueScriptSetup.callee
  }

  if (runtimePlan.vueScript && contains(runtimePlan.vueScript.block, segment.start)) {
    const setupScope = runtimePlan.vueScript.setupScopes.find(scope => segment.start >= scope.contentStart && segment.start <= scope.contentEnd)
    if (setupScope) {
      ensureVueSetupScopeRuntime(content, runtimePlan.replacements, runtimePlan.vueScript, setupScope, config)
      return setupScope.callee
    }

    if (runtimePlan.vueScript.thisScopes.some(scope => segment.start >= scope.start && segment.start <= scope.end))
      return 'this.$t'

    return undefined
  }

  if (runtimePlan.moduleScript) {
    ensureModuleScriptRuntime(runtimePlan.replacements, runtimePlan.moduleScript)
    return runtimePlan.moduleScript.callee
  }

  return undefined
}

function ensureVueScriptSetupRuntime(
  replacements: AdaptReplacement[],
  runtime: VueSetupRuntime,
  config: AdaptConfig,
): void {
  ensureVueUseI18nImport(replacements, runtime.block, runtime.useI18nCallee, config, runtime)
  if (runtime.hasUseI18nBinding || runtime.bindingInserted)
    return

  const insertAt = scriptSetupBindingInsertOffset(runtime.block)
  replacements.push({
    start: insertAt,
    end: insertAt,
    text: `${useI18nBindingStatement('t', runtime.callee, runtime.useI18nCallee)}\n`,
    order: 2,
  })
  runtime.bindingInserted = true
  runtime.block.bindings.add(runtime.callee)
}

function ensureVueSetupScopeRuntime(
  content: string,
  replacements: AdaptReplacement[],
  runtime: VueScriptRuntime,
  scope: SetupScope,
  config: AdaptConfig,
): void {
  ensureVueUseI18nImport(replacements, runtime.block, runtime.useI18nCallee, config, runtime)
  if (scope.hasUseI18nBinding || scope.bindingInserted)
    return

  replacements.push({
    start: scope.bodyStart,
    end: scope.bodyStart,
    text: `\n${indentAt(content, scope.bodyStart)}  ${useI18nBindingStatement('t', scope.callee, runtime.useI18nCallee)}`,
  })
  scope.bindingInserted = true
}

function ensureModuleScriptRuntime(replacements: AdaptReplacement[], runtime: ModuleScriptRuntime): void {
  if (!runtime.shouldInjectImport || !runtime.importConfig || runtime.importInserted)
    return

  replacements.push({
    start: moduleImportInsertOffset(runtime.block),
    end: moduleImportInsertOffset(runtime.block),
    text: `import { ${importSpecifier(runtime.importConfig.named, runtime.callee)} } from '${runtime.importConfig.source}'\n`,
  })
  runtime.importInserted = true
}

function createScriptBlockInfo(content: string, start: number, filePath: string): ScriptBlockInfo {
  const ast = parseScriptAst(content, filePath)
  const imports = ast ? collectImports(ast, start) : []
  const bindings = ast ? collectTopLevelBindings(ast) : new Set<string>()
  return {
    content,
    start,
    end: start + content.length,
    filePath,
    ast,
    imports,
    bindings,
  }
}

function parseScriptAst(content: string, filePath: string): BabelNode | undefined {
  try {
    return babelParse(content, {
      sourceType: 'unambiguous',
      plugins: parserPlugins(filePath),
      errorRecovery: true,
    }) as unknown as BabelNode
  }
  catch {
    return undefined
  }
}

function parserPlugins(filePath: string): Array<'typescript' | 'jsx' | 'decorators-legacy'> {
  const lower = filePath.toLowerCase()
  const plugins: Array<'typescript' | 'jsx' | 'decorators-legacy'> = ['typescript', 'decorators-legacy']
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx'))
    plugins.splice(1, 0, 'jsx')
  return plugins
}

function collectImports(ast: BabelNode, offset: number): ImportInfo[] {
  return programBody(ast)
    .filter(node => node.type === 'ImportDeclaration' && typeof node.start === 'number' && typeof node.end === 'number')
    .map((node) => {
      const specifiers = (node.specifiers ?? [])
        .filter(isBabelNode)
        .map(specifier => ({
          imported: identifierName(specifier.imported),
          local: identifierName(specifier.local) ?? '',
        }))
        .filter(specifier => specifier.local)

      return {
        start: offset + (node.start ?? 0),
        end: offset + (node.end ?? 0),
        source: typeof node.source?.value === 'string' ? node.source.value : '',
        specifiers,
      }
    })
}

function collectTopLevelBindings(ast: BabelNode): Set<string> {
  const bindings = new Set<string>()
  for (const node of programBody(ast)) {
    if (node.type === 'ImportDeclaration') {
      for (const specifier of (node.specifiers ?? []).filter(isBabelNode)) {
        const name = identifierName(specifier.local)
        if (name)
          bindings.add(name)
      }
    }

    if (node.type === 'VariableDeclaration') {
      for (const declaration of (node.declarations ?? []).filter(isBabelNode))
        collectPatternNames(declaration.id, bindings)
    }

    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
      const name = identifierName(node.id)
      if (name)
        bindings.add(name)
    }
  }
  return bindings
}

function collectPatternNames(pattern: unknown, names: Set<string>): void {
  if (!isBabelNode(pattern))
    return

  if (pattern.type === 'Identifier') {
    const name = identifierName(pattern)
    if (name)
      names.add(name)
    return
  }

  for (const value of Object.values(pattern)) {
    if (Array.isArray(value)) {
      for (const child of value)
        collectPatternNames(child, names)
    }
    else {
      collectPatternNames(value, names)
    }
  }
}

function resolveUseI18nCallee(block: ScriptBlockInfo, config: AdaptConfig): string {
  const vueImport = vueRuntimeImport(config)
  return findNamedImportLocal(block, vueImport.source, vueImport.named)
    ?? vueImport.local
}

function findNamedImportLocal(block: ScriptBlockInfo, source: string, imported: string): string | undefined {
  for (const importInfo of block.imports) {
    if (importInfo.source !== source)
      continue

    const specifier = importInfo.specifiers.find(item => item.imported === imported || (!item.imported && item.local === imported))
    if (specifier)
      return specifier.local
  }
  return undefined
}

function ensureVueUseI18nImport(
  replacements: AdaptReplacement[],
  block: ScriptBlockInfo,
  local: string,
  config: AdaptConfig,
  runtime: { importInserted: boolean },
): void {
  if (runtime.importInserted)
    return

  if (!config.runtime.vue.autoImport)
    return

  const vueImport = vueRuntimeImport(config)
  if (findNamedImportLocal(block, vueImport.source, vueImport.named))
    return

  const sameSourceImport = block.imports.find(item => item.source === vueImport.source)
  if (sameSourceImport) {
    replacements.push({
      start: sameSourceImport.end,
      end: sameSourceImport.end,
      text: `\nimport { ${importSpecifier(vueImport.named, local)} } from '${vueImport.source}'`,
      order: 1,
    })
  }
  else {
    const insertAt = moduleImportInsertOffset(block)
    replacements.push({
      start: insertAt,
      end: insertAt,
      text: `import { ${importSpecifier(vueImport.named, local)} } from '${vueImport.source}'\n`,
      order: 1,
    })
  }
  runtime.importInserted = true
}

function vueRuntimeImport(config: AdaptConfig): RuntimeImport {
  const runtimeImport = config.runtime.vue.import
  return {
    source: runtimeImport.source,
    named: runtimeImport.named,
    local: runtimeImport.local ?? runtimeImport.named,
  }
}

function scriptRuntimeImport(config: AdaptConfig): RuntimeImport | undefined {
  const runtimeImport = config.runtime.script.import
  if (!runtimeImport)
    return undefined

  return {
    source: runtimeImport.source,
    named: runtimeImport.named,
    local: runtimeImport.local ?? runtimeImport.named,
  }
}

function createSetupScopes(block: ScriptBlockInfo, useI18nCallee: string, config: AdaptConfig): SetupScope[] {
  if (!block.ast)
    return []

  const scopes: SetupScope[] = []
  visitWithAncestors(block.ast, (node, ancestors) => {
    if (!isSetupFunctionNode(node, ancestors))
      return

    const body = isBabelNode(node.body) ? node.body : undefined
    if (!body || body.type !== 'BlockStatement' || typeof body.start !== 'number' || typeof body.end !== 'number')
      return

    const existingBinding = findUseI18nBindingInRange(block, block.start + body.start, block.start + body.end, useI18nCallee, config.callee.script)
    const callee = existingBinding ?? uniqueIdentifier(config.callee.script, block.bindings)
    if (!existingBinding)
      block.bindings.add(callee)

    scopes.push({
      start: block.start + (node.start ?? body.start),
      end: block.start + (node.end ?? body.end),
      bodyStart: block.start + body.start + 1,
      contentStart: block.start + body.start,
      contentEnd: block.start + body.end,
      callee,
      hasUseI18nBinding: Boolean(existingBinding),
      bindingInserted: false,
    })
  })

  return scopes.sort((left, right) => left.start - right.start)
}

function createOptionsThisScopes(block: ScriptBlockInfo): Array<{ start: number, end: number }> {
  if (!block.ast)
    return []

  const scopes: Array<{ start: number, end: number }> = []
  visitWithAncestors(block.ast, (node, ancestors) => {
    if (!isOptionsFunctionNode(node, ancestors))
      return

    if (typeof node.start !== 'number' || typeof node.end !== 'number')
      return

    scopes.push({
      start: block.start + node.start,
      end: block.start + node.end,
    })
  })

  return scopes.sort((left, right) => left.start - right.start)
}

function findUseI18nBinding(block: ScriptBlockInfo, useI18nCallee: string, preferred: string): string | undefined {
  return findUseI18nBindingInRange(block, block.start, block.end, useI18nCallee, preferred)
}

function findUseI18nBindingInRange(block: ScriptBlockInfo, start: number, end: number, useI18nCallee: string, preferred: string): string | undefined {
  if (!block.ast)
    return undefined

  let fallback: string | undefined
  visit(block.ast, (node) => {
    if (fallback && fallback === preferred)
      return

    if (typeof node.start !== 'number' || typeof node.end !== 'number')
      return

    const absoluteStart = block.start + node.start
    const absoluteEnd = block.start + node.end
    if (absoluteStart < start || absoluteEnd > end || node.type !== 'VariableDeclarator')
      return

    const init = isBabelNode(node.init) ? node.init : undefined
    const id = isBabelNode(node.id) ? node.id : undefined
    if (!id || !init || init.type !== 'CallExpression')
      return

    const callee = isBabelNode(init.callee) ? init.callee : undefined
    if (identifierName(callee) !== useI18nCallee)
      return

    const tName = objectPatternPropertyLocal(id, 't')
    if (tName === preferred)
      fallback = tName
    else if (!fallback && tName)
      fallback = tName
  })

  return fallback
}

function isSetupFunctionNode(node: BabelNode, ancestors: BabelNode[]): boolean {
  if (!isFunctionLike(node))
    return false

  const context = functionOptionContext(node, ancestors)
  return context?.key === 'setup' && isComponentRootObject(context.container, ancestors)
}

function isOptionsFunctionNode(node: BabelNode, ancestors: BabelNode[]): boolean {
  if (!isFunctionLike(node))
    return false
  if (node.type === 'ArrowFunctionExpression')
    return false

  const context = functionOptionContext(node, ancestors)
  if (!context || context.key === 'setup')
    return false

  if (isComponentRootObject(context.container, ancestors))
    return isRootThisOption(context.key)

  const group = componentOptionGroup(context.container, ancestors)
  return group === 'methods' || group === 'computed' || group === 'watch'
}

function functionOptionContext(node: BabelNode, ancestors: BabelNode[]): { key: string, container: BabelNode } | undefined {
  if (node.type === 'ObjectMethod') {
    const container = ancestors.at(-1)
    const key = propertyKeyName(node)
    return key && container?.type === 'ObjectExpression' ? { key, container } : undefined
  }

  const property = ancestors.at(-1)
  const container = ancestors.at(-2)
  const key = property && (property.type === 'ObjectProperty' || property.type === 'ObjectMethod')
    ? propertyKeyName(property)
    : undefined

  return key && container?.type === 'ObjectExpression' ? { key, container } : undefined
}

function isRootThisOption(key: string): boolean {
  return key === 'data'
    || key === 'beforeCreate'
    || key === 'created'
    || key === 'beforeMount'
    || key === 'mounted'
    || key === 'beforeUpdate'
    || key === 'updated'
    || key === 'beforeUnmount'
    || key === 'unmounted'
    || key === 'errorCaptured'
    || key === 'render'
}

function componentOptionGroup(container: BabelNode, ancestors: BabelNode[]): string | undefined {
  const property = parentOf(container, ancestors)
  const root = property ? parentOf(property, ancestors) : undefined
  if (!property || property.type !== 'ObjectProperty' || root?.type !== 'ObjectExpression')
    return undefined

  if (!isComponentRootObject(root, ancestors))
    return undefined

  const key = propertyKeyName(property)
  return key === 'methods' || key === 'computed' || key === 'watch' ? key : undefined
}

function isComponentRootObject(node: BabelNode, ancestors: BabelNode[]): boolean {
  const parent = parentOf(node, ancestors)
  if (!parent)
    return false

  if (parent.type === 'ExportDefaultDeclaration')
    return parent.declaration === node

  if (parent.type !== 'CallExpression')
    return false

  const callee = isBabelNode(parent.callee) ? parent.callee : undefined
  return identifierName(callee) === 'defineComponent' && parent.arguments?.[0] === node
}

function parentOf(node: BabelNode, ancestors: BabelNode[]): BabelNode | undefined {
  const index = ancestors.indexOf(node)
  return index > 0 ? ancestors[index - 1] : undefined
}

function isFunctionLike(node: BabelNode): boolean {
  return node.type === 'FunctionDeclaration'
    || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression'
    || node.type === 'ObjectMethod'
}

function propertyKeyName(node: BabelNode): string | undefined {
  return identifierName(node.key)
}

function objectPatternPropertyLocal(pattern: BabelNode, propertyName: string): string | undefined {
  if (pattern.type !== 'ObjectPattern')
    return undefined

  for (const property of (pattern.properties ?? []).filter(isBabelNode)) {
    if (property.type !== 'ObjectProperty')
      continue

    if (identifierName(property.key) !== propertyName)
      continue

    return identifierName(property.value)
  }
  return undefined
}

function useI18nBindingStatement(imported: string, local: string, useI18nCallee: string): string {
  return imported === local
    ? `const { ${imported} } = ${useI18nCallee}()`
    : `const { ${imported}: ${local} } = ${useI18nCallee}()`
}

function importSpecifier(imported: string, local: string): string {
  return imported === local ? imported : `${imported} as ${local}`
}

function moduleImportInsertOffset(block: ScriptBlockInfo): number {
  const lastImport = block.imports.at(-1)
  return lastImport ? lastImport.end + 1 : blockContentInsertOffset(block)
}

function scriptSetupBindingInsertOffset(block: ScriptBlockInfo): number {
  return moduleImportInsertOffset(block)
}

function blockContentInsertOffset(block: ScriptBlockInfo): number {
  return block.content[0] === '\n' ? block.start + 1 : block.start
}

function scriptBlockPath(filePath: string, lang?: string): string {
  if (lang === 'tsx')
    return `${filePath}.tsx`
  if (lang === 'jsx')
    return `${filePath}.jsx`
  return filePath
}

function isScriptPath(sourcePath: string): boolean {
  return /\.[cm]?[jt]sx?$/i.test(sourcePath)
}

function contains(block: ScriptBlockInfo, offset: number): boolean {
  return offset >= block.start && offset <= block.end
}

function indentAt(content: string, offset: number): string {
  const lineStart = content.lastIndexOf('\n', offset - 1) + 1
  return content.slice(lineStart, offset).match(/^\s*/)?.[0] ?? ''
}

function uniqueIdentifier(base: string, bindings: Set<string>): string {
  if (!bindings.has(base))
    return base

  let index = 1
  while (bindings.has(`${base}${index}`))
    index += 1
  return `${base}${index}`
}

function programBody(ast: BabelNode): BabelNode[] {
  const body = isBabelNode(ast.program) ? ast.program.body : ast.body
  return Array.isArray(body) ? body.filter(isBabelNode) : []
}

function visit(node: unknown, visitor: (node: BabelNode, parent?: BabelNode) => void, parent?: BabelNode): void {
  if (!isBabelNode(node))
    return

  visitor(node, parent)

  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end')
      continue

    if (Array.isArray(value)) {
      for (const child of value)
        visit(child, visitor, node)
    }
    else {
      visit(value, visitor, node)
    }
  }
}

function visitWithAncestors(node: unknown, visitor: (node: BabelNode, ancestors: BabelNode[]) => void, ancestors: BabelNode[] = []): void {
  if (!isBabelNode(node))
    return

  visitor(node, ancestors)

  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end')
      continue

    if (Array.isArray(value)) {
      for (const child of value)
        visitWithAncestors(child, visitor, [...ancestors, node])
    }
    else {
      visitWithAncestors(value, visitor, [...ancestors, node])
    }
  }
}

function isBabelNode(value: unknown): value is BabelNode {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string')
}

function identifierName(node: unknown): string | undefined {
  return isBabelNode(node) && typeof node.name === 'string' ? node.name : undefined
}

function staticAttributeRange(content: string, segment: TextSegment): { start: number, end: number, name: string } | undefined {
  const before = content.slice(0, segment.start)
  const match = before.match(/([:@a-z_][\w:.-]*)\s*=\s*["'][^"'<>]*$/i)
  if (!match?.[1])
    return undefined

  const start = before.length - match[0].length
  const quote = content[segment.start - 1]
  if (!quote || (quote !== '"' && quote !== '\''))
    return undefined

  let end = segment.end
  if (content[end] === quote)
    end += 1

  return {
    start,
    end,
    name: match[1],
  }
}

function callExpression(callee: string, key: string, params: AdaptParam[]): string {
  const keyLiteral = quoteString(key)
  const paramObject = params.map(formatParam).join(', ')
  return params.length
    ? `${callee}(${keyLiteral}, { ${paramObject} })`
    : `${callee}(${keyLiteral})`
}

function keyReference(sourcePath: string, key: string, config: AdaptConfig): string {
  if (config.keyReference.mode === 'local')
    return key

  const modulePath = sourcePath
    .replace(/^(?:src|source)\//, '')
    .replace(/\.[^.]+$/, '')
    .split('/')
    .filter(Boolean)
    .join(config.keyReference.separator)

  return modulePath
    ? `${modulePath}${config.keyReference.separator}${key}`
    : key
}

function paramsForSegment(segment: TextSegment): AdaptParam[] {
  const params = (segment.interpolation?.segments ?? [])
    .map(raw => raw.replace(/^\{\{|\}\}$/g, '').replace(/^\$\{|\}$/g, '').trim())
    .filter(expression => /^[a-z_$][\w$]*(?:\.[a-z_$][\w$]*|\[[^\]]+\])*$/i.test(expression))
    .map(expression => ({
      name: paramNameForExpression(expression),
      expression,
    }))

  return uniqueParams(params)
}

function formatParam(param: AdaptParam): string {
  return param.name === param.expression
    ? param.name
    : `${param.name}: ${param.expression}`
}

function uniqueParams(params: AdaptParam[]): AdaptParam[] {
  const seen = new Set<string>()
  return params.filter((param) => {
    const signature = `${param.name}:${param.expression}`
    if (seen.has(signature))
      return false
    seen.add(signature)
    return true
  })
}

function quoteString(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}

function skip(sourcePath: string, text: string, key: string | undefined, reason: string, suggestion: string): AdaptSkip {
  return {
    sourcePath: toPosixPath(sourcePath),
    text,
    key,
    reason,
    suggestion,
  }
}
