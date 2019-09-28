import {
  ElementNode,
  ObjectExpression,
  createObjectExpression,
  NodeTypes,
  createCompoundExpression,
  createCallExpression,
  CompoundExpressionNode,
  CallExpression
} from '../ast'
import { TransformContext } from '../transform'
import { buildProps } from './transformElement'
import { createCompilerError, ErrorCodes } from '../errors'
import { isSimpleIdentifier } from '../utils'
import { RENDER_SLOT } from '../runtimeConstants'

export function buildSlots(
  { loc, children }: ElementNode,
  context: TransformContext
): ObjectExpression {
  const slots = createObjectExpression([], loc)
  // TODO

  return slots
}

export function buildSlotOutlet(node: ElementNode, context: TransformContext) {
  const { props, children, loc } = node
  const $slots = context.prefixIdentifiers ? `_ctx.$slots` : `$slots`
  let slot: string | CompoundExpressionNode = $slots + `.default`

  // check for <slot name="xxx" OR :name="xxx" />
  let nameIndex: number = -1
  for (let i = 0; i < props.length; i++) {
    const prop = props[i]
    if (prop.type === NodeTypes.ATTRIBUTE) {
      if (prop.name === `name` && prop.value) {
        // static name="xxx"
        const name = prop.value.content
        const accessor = isSimpleIdentifier(name)
          ? `.${name}`
          : `[${JSON.stringify(name)}]`
        slot = `${$slots}${accessor}`
        nameIndex = i
        break
      }
    } else if (prop.name === `bind`) {
      const { arg, exp } = prop
      if (
        arg &&
        exp &&
        arg.type === NodeTypes.SIMPLE_EXPRESSION &&
        arg.isStatic &&
        arg.content === `name`
      ) {
        // dynamic :name="xxx"
        slot = createCompoundExpression(
          [
            $slots + `[`,
            ...(exp.type === NodeTypes.SIMPLE_EXPRESSION
              ? [exp]
              : exp.children),
            `]`
          ],
          loc
        )
        nameIndex = i
        break
      }
    }
  }

  const slotArgs: CallExpression['arguments'] = [slot]
  const propsWithoutName =
    nameIndex > -1
      ? props.slice(0, nameIndex).concat(props.slice(nameIndex + 1))
      : props
  const hasProps = propsWithoutName.length
  if (hasProps) {
    const { props: propsExpression, directives } = buildProps(
      propsWithoutName,
      loc,
      context
    )
    if (directives.length) {
      context.onError(
        createCompilerError(ErrorCodes.X_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET)
      )
    }
    slotArgs.push(propsExpression)
  }

  if (children.length) {
    if (!hasProps) {
      slotArgs.push(`{}`)
    }
    slotArgs.push(children)
  }

  node.codegenNode = createCallExpression(
    context.helper(RENDER_SLOT),
    slotArgs,
    loc
  )
}
