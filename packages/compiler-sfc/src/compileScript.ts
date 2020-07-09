import MagicString, { SourceMap } from 'magic-string'
import { SFCDescriptor, SFCScriptBlock } from './parse'
import { parse, ParserPlugin } from '@babel/parser'
import { babelParserDefautPlugins, generateCodeFrame } from '@vue/shared'
import {
  Node,
  Declaration,
  ObjectPattern,
  ArrayPattern,
  Identifier,
  ExpressionStatement,
  ArrowFunctionExpression,
  ExportSpecifier,
  TSTypeLiteral,
  TSFunctionType,
  TSDeclareFunction
} from '@babel/types'
import { walk } from 'estree-walker'

export interface BindingMetadata {
  [key: string]: 'data' | 'props' | 'setup' | 'ctx'
}

export interface SFCScriptCompileOptions {
  parserPlugins?: ParserPlugin[]
}

/**
 * Compile `<script setup>`
 * It requires the whole SFC descriptor because we need to handle and merge
 * normal `<script>` + `<script setup>` if both are present.
 */
export function compileScriptSetup(
  sfc: SFCDescriptor,
  options: SFCScriptCompileOptions = {}
) {
  const { script, scriptSetup, source, filename } = sfc
  if (!scriptSetup) {
    throw new Error('SFC has no <script setup>.')
  }

  if (script && script.lang !== scriptSetup.lang) {
    throw new Error(
      `<script> and <script setup> must have the same language type.`
    )
  }

  const bindings: BindingMetadata = {}
  const imports: Record<string, string> = {}
  const setupScopeVars: Record<string, boolean> = {}
  const setupExports: Record<string, boolean> = {}
  let exportAllIndex = 0
  let defaultExport: Node | undefined
  let needDefaultExportRefCheck: boolean = false

  const checkDuplicateDefaultExport = (node: Node) => {
    if (defaultExport) {
      // <script> already has export default
      throw new Error(
        `Default export is already declared in normal <script>.\n\n` +
          generateCodeFrame(
            source,
            node.start! + startOffset,
            node.start! + startOffset + `export default`.length
          )
      )
    }
  }

  const s = new MagicString(source)
  const startOffset = scriptSetup.loc.start.offset
  const endOffset = scriptSetup.loc.end.offset
  const scriptStartOffset = script && script.loc.start.offset
  const scriptEndOffset = script && script.loc.end.offset

  const isTS = scriptSetup.lang === 'ts'
  const plugins: ParserPlugin[] = [
    ...(options.parserPlugins || []),
    ...babelParserDefautPlugins,
    ...(isTS ? (['typescript'] as const) : [])
  ]

  // 1. process normal <script> first if it exists
  if (script) {
    // import dedupe between <script> and <script setup>
    const scriptAST = parse(script.content, {
      plugins,
      sourceType: 'module'
    }).program.body

    for (const node of scriptAST) {
      if (node.type === 'ImportDeclaration') {
        // record imports for dedupe
        for (const {
          local: { name }
        } of node.specifiers) {
          imports[name] = node.source.value
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        // export default
        defaultExport = node
        const start = node.start! + scriptStartOffset!
        s.overwrite(
          start,
          start + `export default`.length,
          `const __default__ =`
        )
      } else if (node.type === 'ExportNamedDeclaration' && node.specifiers) {
        const defaultSpecifier = node.specifiers.find(
          s => s.exported.name === 'default'
        ) as ExportSpecifier
        if (defaultSpecifier) {
          defaultExport = node
          // 1. remove specifier
          if (node.specifiers.length > 1) {
            s.remove(
              defaultSpecifier.start! + scriptStartOffset!,
              defaultSpecifier.end! + scriptStartOffset!
            )
          } else {
            s.remove(
              node.start! + scriptStartOffset!,
              node.end! + scriptStartOffset!
            )
          }
          if (node.source) {
            // export { x as default } from './x'
            // rewrite to `import { x as __default__ } from './x'` and
            // add to top
            s.prepend(
              `import { ${defaultSpecifier.local.name} as __default__ } from '${
                node.source.value
              }'\n`
            )
          } else {
            // export { x as default }
            // rewrite to `const __default__ = x` and move to end
            s.append(`\nconst __default__ = ${defaultSpecifier.local.name}\n`)
          }
        }
      }
    }
  }

  // 2. check <script setup="xxx"> function signature
  const hasExplicitSignature = typeof scriptSetup.setup === 'string'

  let propsVar: string | undefined
  let emitVar: string | undefined
  let slotsVar: string | undefined
  let attrsVar: string | undefined

  let propsType = `{}`
  let emitType = `(e: string, ...args: any[]) => void`
  let slotsType = `__Slots__`
  let attrsType = `Record<string, any>`

  let propsASTNode
  let setupCtxASTNode

  // props/emits declared via types
  const typeDeclaredProps: Set<string> = new Set()
  const typeDeclaredEmits: Set<string> = new Set()

  if (isTS && hasExplicitSignature) {
    // <script setup="xxx" lang="ts">
    // parse the signature to extract the props/emit variables the user wants
    // we need them to find corresponding type declarations.
    const signatureAST = parse(`(${scriptSetup.setup})=>{}`, { plugins })
      .program.body[0]
    const params = ((signatureAST as ExpressionStatement)
      .expression as ArrowFunctionExpression).params
    if (params[0] && params[0].type === 'Identifier') {
      propsASTNode = params[0]
      propsVar = propsASTNode.name
    }
    if (params[1] && params[1].type === 'ObjectPattern') {
      setupCtxASTNode = params[1]
      for (const p of params[1].properties) {
        if (
          p.type === 'ObjectProperty' &&
          p.key.type === 'Identifier' &&
          p.value.type === 'Identifier'
        ) {
          if (p.key.name === 'emit') {
            emitVar = p.value.name
          } else if (p.key.name === 'slots') {
            slotsVar = p.value.name
          } else if (p.key.name === 'attrs') {
            attrsVar = p.value.name
          }
        }
      }
    }
  }

  // 3. parse <script setup> and  walk over top level statements
  for (const node of parse(scriptSetup.content, {
    plugins,
    sourceType: 'module'
  }).program.body) {
    const start = node.start! + startOffset
    let end = node.end! + startOffset
    // import or type declarations: move to top
    // locate the end of whitespace between this statement and the next
    while (end <= source.length) {
      if (!/\s/.test(source.charAt(end))) {
        break
      }
      end++
    }

    if (node.type === 'ImportDeclaration') {
      // import declarations are moved to top
      s.move(start, end, 0)
      // dedupe imports
      let prev
      let removed = 0
      for (const specifier of node.specifiers) {
        if (imports[specifier.local.name]) {
          // already imported in <script setup>, dedupe
          removed++
          s.remove(
            prev ? prev.end! + startOffset : specifier.start! + startOffset,
            specifier.end! + startOffset
          )
        } else {
          imports[specifier.local.name] = node.source.value
        }
        prev = specifier
      }
      if (removed === node.specifiers.length) {
        s.remove(node.start! + startOffset, node.end! + startOffset)
      }
    }

    if (node.type === 'ExportNamedDeclaration' && node.exportKind !== 'type') {
      // named exports
      if (node.declaration) {
        // variable/function/class declarations.
        // remove leading `export ` keyword
        s.remove(start, start + 7)
        walkDeclaration(node.declaration, setupExports)
      }
      if (node.specifiers.length) {
        // named export with specifiers
        if (node.source) {
          // export { x } from './x'
          // change it to import and move to top
          s.overwrite(start, start + 6, 'import')
          s.move(start, end, 0)
        } else {
          // export { x }
          s.remove(start, end)
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ExportDefaultSpecifier') {
            // export default from './x'
            // rewrite to `import __default__ from './x'`
            checkDuplicateDefaultExport(node)
            defaultExport = node
            s.overwrite(
              specifier.exported.start! + startOffset,
              specifier.exported.start! + startOffset + 7,
              '__default__'
            )
          } else if (specifier.type === 'ExportSpecifier') {
            if (specifier.exported.name === 'default') {
              checkDuplicateDefaultExport(node)
              defaultExport = node
              // 1. remove specifier
              if (node.specifiers.length > 1) {
                // removing the default specifier from a list of specifiers.
                // look ahead until we reach the first non , or whitespace char.
                let end = specifier.end! + startOffset
                while (end < source.length) {
                  if (/[^,\s]/.test(source.charAt(end))) {
                    break
                  }
                  end++
                }
                s.remove(specifier.start! + startOffset, end)
              } else {
                s.remove(node.start! + startOffset!, node.end! + startOffset!)
              }
              if (!node.source) {
                // export { x as default, ... }
                const local = specifier.local.name
                if (setupScopeVars[local] || setupExports[local]) {
                  throw new Error(
                    `Cannot export locally defined variable as default in <script setup>.\n` +
                      `Default export must be an object literal with no reference to local scope.\n` +
                      generateCodeFrame(
                        source,
                        specifier.start! + startOffset,
                        specifier.end! + startOffset
                      )
                  )
                }
                // rewrite to `const __default__ = x` and move to end
                s.append(`\nconst __default__ = ${local}\n`)
              } else {
                // export { x as default } from './x'
                // rewrite to `import { x as __default__ } from './x'` and
                // add to top
                s.prepend(
                  `import { ${specifier.local.name} as __default__ } from '${
                    node.source.value
                  }'\n`
                )
              }
            } else {
              setupExports[specifier.exported.name] = true
              if (node.source) {
                imports[specifier.exported.name] = node.source.value
              }
            }
          }
        }
      }
    }

    if (node.type === 'ExportAllDeclaration') {
      // export * from './x'
      s.overwrite(
        start,
        node.source.start! + startOffset,
        `import * as __export_all_${exportAllIndex++}__ from `
      )
      s.move(start, end, 0)
    }

    if (node.type === 'ExportDefaultDeclaration') {
      checkDuplicateDefaultExport(node)
      // export default {} inside <script setup>
      // this should be kept in module scope - move it to the end
      s.move(start, end, source.length)
      s.overwrite(start, start + `export default`.length, `const __default__ =`)
      // save it for analysis when all imports and variable declarations have
      // been recorded
      defaultExport = node
      needDefaultExportRefCheck = true
    }

    if (
      (node.type === 'VariableDeclaration' ||
        node.type === 'FunctionDeclaration' ||
        node.type === 'ClassDeclaration') &&
      !node.declare
    ) {
      walkDeclaration(node, setupScopeVars)
    }

    // Type declarations
    if (node.type === 'VariableDeclaration' && node.declare) {
      s.remove(start, end)
      for (const { id } of node.declarations) {
        if (id.type === 'Identifier') {
          if (
            id.typeAnnotation &&
            id.typeAnnotation.type === 'TSTypeAnnotation'
          ) {
            const typeNode = id.typeAnnotation.typeAnnotation
            const typeString = source.slice(
              typeNode.start! + startOffset,
              typeNode.end! + startOffset
            )
            if (typeNode.type === 'TSTypeLiteral') {
              if (id.name === propsVar) {
                propsType = typeString
                extractProps(typeNode, typeDeclaredProps)
              } else if (id.name === slotsVar) {
                slotsType = typeString
              } else if (id.name === attrsVar) {
                attrsType = typeString
              }
            } else if (
              id.name === emitVar &&
              typeNode.type === 'TSFunctionType'
            ) {
              emitType = typeString
              extractEmits(typeNode, typeDeclaredEmits)
            }
          }
        }
      }
    }

    if (
      node.type === 'TSDeclareFunction' &&
      node.id &&
      node.id.name === emitVar
    ) {
      const index = node.id.start! + startOffset
      s.overwrite(index, index + emitVar.length, '__emit__')
      emitType = `typeof __emit__`
      extractEmits(node, typeDeclaredEmits)
    }

    // move all type declarations to outer scope
    if (
      node.type.startsWith('TS') ||
      (node.type === 'ExportNamedDeclaration' && node.exportKind === 'type')
    ) {
      s.move(start, end, 0)
    }
  }

  // check default export to make sure it doesn't reference setup scope
  // variables
  if (needDefaultExportRefCheck) {
    checkDefaultExport(
      defaultExport!,
      setupScopeVars,
      imports,
      setupExports,
      source,
      startOffset
    )
  }

  // remove non-script content
  if (script) {
    if (startOffset < scriptStartOffset!) {
      // <script setup> before <script>
      s.remove(endOffset, scriptStartOffset!)
      s.remove(scriptEndOffset!, source.length)
    } else {
      // <script> before <script setup>
      s.remove(0, scriptStartOffset!)
      s.remove(scriptEndOffset!, startOffset)
      s.remove(endOffset, source.length)
    }
  } else {
    // only <script setup>
    s.remove(0, startOffset)
    s.remove(endOffset, source.length)
  }

  // wrap setup code with function
  // finalize the argument signature.
  let args = ``
  if (isTS) {
    if (slotsType === '__Slots__') {
      s.prepend(`import { Slots as __Slots__ } from 'vue'\n`)
    }
    const ctxType = `{
  emit: ${emitType},
  slots: ${slotsType},
  attrs: ${attrsType}
}`
    if (hasExplicitSignature) {
      // inject types to user signature
      args = scriptSetup.setup as string
      const ss = new MagicString(args)
      if (propsASTNode) {
        // compensate for () wraper offset
        ss.appendRight(propsASTNode.end! - 1, `: ${propsType}`)
      }
      if (setupCtxASTNode) {
        ss.appendRight(setupCtxASTNode.end! - 1!, `: ${ctxType}`)
      }
      args = ss.toString()
    }
  } else {
    args = hasExplicitSignature ? (scriptSetup.setup as string) : ``
  }

  // export the content of <script setup> as a named export, `setup`.
  // this allows `import { setup } from '*.vue'` for testing purposes.
  s.appendLeft(startOffset, `\nexport function setup(${args}) {\n`)

  // generate return statement
  let returned = `{ ${Object.keys(setupExports).join(', ')} }`

  // handle `export * from`. We need to call `toRefs` on the imported module
  // object before merging.
  if (exportAllIndex > 0) {
    s.prepend(`import { toRefs as __toRefs__ } from 'vue'\n`)
    for (let i = 0; i < exportAllIndex; i++) {
      returned += `,\n  __toRefs__(__export_all_${i}__)`
    }
    returned = `Object.assign(\n  ${returned}\n)`
  }

  s.appendRight(endOffset, `\nreturn ${returned}\n}\n\n`)

  // finalize default export
  if (isTS) {
    // for TS, make sure the exported type is still valid type with
    // correct props information
    s.prepend(`import { defineComponent as __define__ } from 'vue'\n`)
    // we have to use object spread for types to be merged properly
    // user's TS setting should compile it down to proper targets
    const def = defaultExport ? `\n  ...__default__,` : ``
    const runtimeProps = typeDeclaredProps.size
      ? `\n  props: [${Array.from(typeDeclaredProps)
          .map(p => JSON.stringify(p))
          .join(', ')}] as unknown as undefined,`
      : ``
    const runtimeEmits = typeDeclaredEmits.size
      ? `\n  emits: [${Array.from(typeDeclaredEmits)
          .map(p => JSON.stringify(p))
          .join(', ')}] as unknown as undefined,`
      : ``
    s.append(
      `export default __define__({${def}${runtimeProps}${runtimeEmits}\n  setup\n})`
    )
  } else {
    if (defaultExport) {
      s.append(`__default__.setup = setup\nexport default __default__`)
    } else {
      s.append(`export default { setup }`)
    }
  }

  s.trim()

  // analyze bindings for template compiler optimization
  if (script) {
    Object.assign(bindings, analyzeScriptBindings(script))
  }
  Object.keys(setupExports).forEach(key => {
    bindings[key] = 'setup'
  })

  return {
    bindings,
    code: s.toString(),
    map: s.generateMap({
      source: filename,
      hires: true,
      includeContent: true
    }) as SourceMap
  }
}

function walkDeclaration(node: Declaration, bindings: Record<string, boolean>) {
  if (node.type === 'VariableDeclaration') {
    // export const foo = ...
    for (const { id } of node.declarations) {
      if (id.type === 'Identifier') {
        bindings[id.name] = true
      } else if (id.type === 'ObjectPattern') {
        walkObjectPattern(id, bindings)
      } else if (id.type === 'ArrayPattern') {
        walkArrayPattern(id, bindings)
      }
    }
  } else if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'ClassDeclaration'
  ) {
    // export function foo() {} / export class Foo {}
    // export declarations must be named.
    bindings[node.id!.name] = true
  }
}

function walkObjectPattern(
  node: ObjectPattern,
  bindings: Record<string, boolean>
) {
  for (const p of node.properties) {
    if (p.type === 'ObjectProperty') {
      // key can only be Identifier in ObjectPattern
      if (p.key.type === 'Identifier') {
        if (p.key === p.value) {
          // const { x } = ...
          bindings[p.key.name] = true
        } else {
          walkPattern(p.value, bindings)
        }
      }
    } else {
      // ...rest
      // argument can only be identifer when destructuring
      bindings[(p.argument as Identifier).name] = true
    }
  }
}

function walkArrayPattern(
  node: ArrayPattern,
  bindings: Record<string, boolean>
) {
  for (const e of node.elements) {
    e && walkPattern(e, bindings)
  }
}

function walkPattern(node: Node, bindings: Record<string, boolean>) {
  if (node.type === 'Identifier') {
    bindings[node.name] = true
  } else if (node.type === 'RestElement') {
    // argument can only be identifer when destructuring
    bindings[(node.argument as Identifier).name] = true
  } else if (node.type === 'ObjectPattern') {
    walkObjectPattern(node, bindings)
  } else if (node.type === 'ArrayPattern') {
    walkArrayPattern(node, bindings)
  } else if (node.type === 'AssignmentPattern') {
    if (node.left.type === 'Identifier') {
      bindings[node.left.name] = true
    } else {
      walkPattern(node.left, bindings)
    }
  }
}

function extractProps(node: TSTypeLiteral, props: Set<string>) {
  // TODO generate type/required checks in dev
  for (const m of node.members) {
    if (m.type === 'TSPropertySignature' && m.key.type === 'Identifier') {
      props.add(m.key.name)
    }
  }
}

function extractEmits(
  node: TSFunctionType | TSDeclareFunction,
  emits: Set<string>
) {
  const eventName =
    node.type === 'TSDeclareFunction' ? node.params[0] : node.parameters[0]
  if (
    eventName.type === 'Identifier' &&
    eventName.typeAnnotation &&
    eventName.typeAnnotation.type === 'TSTypeAnnotation'
  ) {
    const typeNode = eventName.typeAnnotation.typeAnnotation
    if (typeNode.type === 'TSLiteralType') {
      emits.add(String(typeNode.literal.value))
    } else if (typeNode.type === 'TSUnionType') {
      for (const t of typeNode.types) {
        if (t.type === 'TSLiteralType') {
          emits.add(String(t.literal.value))
        }
      }
    }
  }
}

/**
 * export default {} inside <script setup> cannot access variables declared
 * inside since it's hoisted. Walk and check to make sure.
 */
function checkDefaultExport(
  root: Node,
  scopeVars: Record<string, boolean>,
  imports: Record<string, string>,
  exports: Record<string, boolean>,
  source: string,
  offset: number
) {
  const knownIds: Record<string, number> = Object.create(null)
  ;(walk as any)(root, {
    enter(node: Node & { scopeIds?: Set<string> }, parent: Node) {
      if (node.type === 'Identifier') {
        if (
          !knownIds[node.name] &&
          !isStaticPropertyKey(node, parent) &&
          (scopeVars[node.name] || (!imports[node.name] && exports[node.name]))
        ) {
          throw new Error(
            `\`export default\` in <script setup> cannot reference locally ` +
              `declared variables because it will be hoisted outside of the ` +
              `setup() function. If your component options requires initialization ` +
              `in the module scope, use a separate normal <script> to export ` +
              `the options instead.\n\n` +
              generateCodeFrame(
                source,
                node.start! + offset,
                node.end! + offset
              )
          )
        }
      } else if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        // walk function expressions and add its arguments to known identifiers
        // so that we don't prefix them
        node.params.forEach(p =>
          (walk as any)(p, {
            enter(child: Node, parent: Node) {
              if (
                child.type === 'Identifier' &&
                // do not record as scope variable if is a destructured key
                !isStaticPropertyKey(child, parent) &&
                // do not record if this is a default value
                // assignment of a destructured variable
                !(
                  parent &&
                  parent.type === 'AssignmentPattern' &&
                  parent.right === child
                )
              ) {
                const { name } = child
                if (node.scopeIds && node.scopeIds.has(name)) {
                  return
                }
                if (name in knownIds) {
                  knownIds[name]++
                } else {
                  knownIds[name] = 1
                }
                ;(node.scopeIds || (node.scopeIds = new Set())).add(name)
              }
            }
          })
        )
      }
    },
    leave(node: Node & { scopeIds?: Set<string> }) {
      if (node.scopeIds) {
        node.scopeIds.forEach((id: string) => {
          knownIds[id]--
          if (knownIds[id] === 0) {
            delete knownIds[id]
          }
        })
      }
    }
  })
}

function isStaticPropertyKey(node: Node, parent: Node): boolean {
  return (
    parent &&
    (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') &&
    !parent.computed &&
    parent.key === node
  )
}

/**
 * Analyze bindings in normal `<script>`
 * Note that `compileScriptSetup` already analyzes bindings as part of its
 * compilation process so this should only be used on single `<script>` SFCs.
 */
export function analyzeScriptBindings(
  _script: SFCScriptBlock
): BindingMetadata {
  return {
    // TODO
  }
}
