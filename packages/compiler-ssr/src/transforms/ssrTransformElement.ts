import {
  NodeTransform,
  NodeTypes,
  ElementTypes,
  TemplateLiteral,
  createTemplateLiteral,
  createInterpolation,
  createCallExpression,
  createConditionalExpression,
  createSimpleExpression,
  buildProps,
  DirectiveNode,
  PlainElementNode,
  createCompilerError,
  ErrorCodes,
  CallExpression,
  createArrayExpression,
  ExpressionNode,
  JSChildNode,
  ArrayExpression,
  createAssignmentExpression,
  TextNode,
  hasDynamicKeyVBind
} from '@vue/compiler-dom'
import { escapeHtml, isBooleanAttr, isSSRSafeAttrName } from '@vue/shared'
import { createSSRCompilerError, SSRErrorCodes } from '../errors'
import {
  SSR_RENDER_ATTR,
  SSR_RENDER_CLASS,
  SSR_RENDER_STYLE,
  SSR_RENDER_DYNAMIC_ATTR,
  SSR_RENDER_ATTRS,
  SSR_INTERPOLATE
} from '../runtimeHelpers'

export const ssrTransformElement: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.ELEMENT
  ) {
    return function ssrPostTransformElement() {
      // element
      // generate the template literal representing the open tag.
      const openTag: TemplateLiteral['elements'] = [`<${node.tag}`]
      let rawChildren

      // v-bind="obj" or v-bind:[key] can potentially overwrite other static
      // attrs and can affect final rendering result, so when they are present
      // we need to bail out to full `renderAttrs`
      const hasDynamicVBind = hasDynamicKeyVBind(node)
      if (hasDynamicVBind) {
        const { props } = buildProps(node, context, node.props, true /* ssr */)
        if (props) {
          const propsExp = createCallExpression(
            context.helper(SSR_RENDER_ATTRS),
            [props]
          )
          if (node.tag === 'textarea') {
            // <textarea> with dynamic v-bind. We don't know if the final props
            // will contain .value, so we will have to do something special:
            // assign the merged props to a temp variable, and check whether
            // it contains value (if yes, render is as children).
            const tempId = `_temp${context.temps++}`
            propsExp.arguments[0] = createAssignmentExpression(
              createSimpleExpression(tempId, false),
              props
            )
            const existingText = node.children[0] as TextNode | undefined
            node.children = []
            rawChildren = createCallExpression(
              context.helper(SSR_INTERPOLATE),
              [
                createConditionalExpression(
                  createSimpleExpression(`"value" in ${tempId}`, false),
                  createSimpleExpression(`${tempId}.value`, false),
                  createSimpleExpression(
                    existingText ? existingText.content : ``,
                    true
                  ),
                  false
                )
              ]
            )
          }
          openTag.push(propsExp)
        }
      }

      // book keeping static/dynamic class merging.
      let dynamicClassBinding: CallExpression | undefined = undefined
      let staticClassBinding: string | undefined = undefined
      // all style bindings are converted to dynamic by transformStyle.
      // but we need to make sure to merge them.
      let dynamicStyleBinding: CallExpression | undefined = undefined

      for (let i = 0; i < node.props.length; i++) {
        const prop = node.props[i]
        // special cases with children override
        if (prop.type === NodeTypes.DIRECTIVE) {
          if (prop.name === 'html' && prop.exp) {
            node.children = []
            rawChildren = prop.exp
          } else if (prop.name === 'text' && prop.exp) {
            node.children = [createInterpolation(prop.exp, prop.loc)]
          } else if (prop.name === 'slot') {
            context.onError(
              createCompilerError(ErrorCodes.X_V_SLOT_MISPLACED, prop.loc)
            )
          } else if (isTextareaWithValue(node, prop) && prop.exp) {
            if (!hasDynamicVBind) {
              node.children = [createInterpolation(prop.exp, prop.loc)]
            }
          } else {
            // Directive transforms.
            const directiveTransform = context.directiveTransforms[prop.name]
            if (!directiveTransform) {
              // no corresponding ssr directive transform found.
              context.onError(
                createSSRCompilerError(
                  SSRErrorCodes.X_SSR_CUSTOM_DIRECTIVE_NO_TRANSFORM,
                  prop.loc
                )
              )
            } else if (!hasDynamicVBind) {
              const { props } = directiveTransform(prop, node, context)
              for (let j = 0; j < props.length; j++) {
                const { key, value } = props[j]
                if (key.type === NodeTypes.SIMPLE_EXPRESSION && key.isStatic) {
                  const attrName = key.content
                  // static key attr
                  if (attrName === 'class') {
                    openTag.push(
                      (dynamicClassBinding = createCallExpression(
                        context.helper(SSR_RENDER_CLASS),
                        [value]
                      ))
                    )
                  } else if (attrName === 'style') {
                    if (dynamicStyleBinding) {
                      // already has style binding, merge into it.
                      mergeCall(dynamicStyleBinding, value)
                    } else {
                      openTag.push(
                        (dynamicStyleBinding = createCallExpression(
                          context.helper(SSR_RENDER_STYLE),
                          [value]
                        ))
                      )
                    }
                  } else if (isBooleanAttr(attrName)) {
                    openTag.push(
                      createConditionalExpression(
                        value,
                        createSimpleExpression(' ' + attrName, true),
                        createSimpleExpression('', true),
                        false /* no newline */
                      )
                    )
                  } else {
                    if (isSSRSafeAttrName(attrName)) {
                      openTag.push(
                        createCallExpression(context.helper(SSR_RENDER_ATTR), [
                          key,
                          value
                        ])
                      )
                    } else {
                      context.onError(
                        createSSRCompilerError(
                          SSRErrorCodes.X_SSR_UNSAFE_ATTR_NAME,
                          key.loc
                        )
                      )
                    }
                  }
                } else {
                  // dynamic key attr
                  // this branch is only encountered for custom directive
                  // transforms that returns properties with dynamic keys
                  openTag.push(
                    createCallExpression(
                      context.helper(SSR_RENDER_DYNAMIC_ATTR),
                      [key, value]
                    )
                  )
                }
              }
            }
          }
        } else {
          // special case: value on <textarea>
          if (node.tag === 'textarea' && prop.name === 'value' && prop.value) {
            node.children = []
            rawChildren = escapeHtml(prop.value.content)
          } else if (!hasDynamicVBind) {
            // static prop
            if (prop.name === 'class' && prop.value) {
              staticClassBinding = JSON.stringify(prop.value.content)
            }
            openTag.push(
              ` ${prop.name}` +
                (prop.value ? `="${escapeHtml(prop.value.content)}"` : ``)
            )
          }
        }
      }

      // handle co-existence of dynamic + static class bindings
      if (dynamicClassBinding && staticClassBinding) {
        mergeCall(dynamicClassBinding, staticClassBinding)
        removeStaticBinding(openTag, 'class')
      }

      openTag.push(`>`)
      if (rawChildren) {
        openTag.push(rawChildren)
      }
      node.ssrCodegenNode = createTemplateLiteral(openTag)
    }
  }
}

function isTextareaWithValue(
  node: PlainElementNode,
  prop: DirectiveNode
): boolean {
  return !!(
    node.tag === 'textarea' &&
    prop.name === 'bind' &&
    prop.arg &&
    prop.arg.type === NodeTypes.SIMPLE_EXPRESSION &&
    prop.arg.isStatic &&
    prop.arg.content === 'value'
  )
}

function mergeCall(call: CallExpression, arg: string | JSChildNode) {
  const existing = call.arguments[0] as ExpressionNode | ArrayExpression
  if (existing.type === NodeTypes.JS_ARRAY_EXPRESSION) {
    existing.elements.push(arg)
  } else {
    call.arguments[0] = createArrayExpression([existing, arg])
  }
}

function removeStaticBinding(
  tag: TemplateLiteral['elements'],
  binding: string
) {
  const i = tag.findIndex(
    e => typeof e === 'string' && e.startsWith(` ${binding}=`)
  )
  if (i > -1) {
    tag.splice(i, 1)
  }
}
