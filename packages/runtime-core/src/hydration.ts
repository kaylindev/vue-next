import {
  VNode,
  normalizeVNode,
  Text,
  Comment,
  Static,
  Fragment,
  Portal
} from './vnode'
import { queuePostFlushCb, flushPostFlushCbs } from './scheduler'
import { ComponentInternalInstance } from './component'
import { invokeDirectiveHook } from './directives'
import { ShapeFlags } from './shapeFlags'
import { warn } from './warning'
import { PatchFlags, isReservedProp, isOn } from '@vue/shared'

// Note: hydration is DOM-specific
// but we have to place it in core due to tight coupling with core - splitting
// it out creates a ton of unnecessary complexity.
export function createHydrateFn(
  mountComponent: any, // TODO
  patchProp: any // TODO
) {
  function hydrate(vnode: VNode, container: Element) {
    if (__DEV__ && !container.hasChildNodes()) {
      warn(`Attempting to hydrate existing markup but container is empty.`)
      return
    }
    hydrateNode(container.firstChild!, vnode)
    flushPostFlushCbs()
  }

  // TODO handle mismatches
  // TODO SVG
  // TODO Suspense
  function hydrateNode(
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null = null
  ): Node | null | undefined {
    const { type, shapeFlag } = vnode
    vnode.el = node
    switch (type) {
      case Text:
      case Comment:
      case Static:
        return node.nextSibling
      case Fragment:
        const anchor = (vnode.anchor = hydrateChildren(
          node.nextSibling,
          vnode.children as VNode[],
          parentComponent
        )!)
        // TODO handle potential hydration error if fragment didn't get
        // back anchor as expected.
        return anchor.nextSibling
      case Portal:
        // TODO
        break
      default:
        if (shapeFlag & ShapeFlags.ELEMENT) {
          return hydrateElement(node as Element, vnode, parentComponent)
        } else if (shapeFlag & ShapeFlags.COMPONENT) {
          mountComponent(vnode, null, null, parentComponent, null, false)
          const subTree = vnode.component!.subTree
          return (subTree.anchor || subTree.el).nextSibling
        } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
          // TODO
        } else if (__DEV__) {
          warn('Invalid HostVNode type:', type, `(${typeof type})`)
        }
    }
  }

  function hydrateElement(
    el: Element,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null
  ) {
    const { props, patchFlag } = vnode
    // skip props & children if this is hoisted static nodes
    if (patchFlag !== PatchFlags.HOISTED) {
      // props
      if (props !== null) {
        if (
          patchFlag & PatchFlags.FULL_PROPS ||
          patchFlag & PatchFlags.HYDRATE_EVENTS
        ) {
          for (const key in props) {
            if (!isReservedProp(key) && isOn(key)) {
              patchProp(el, key, props[key], null)
            }
          }
        } else if (props.onClick != null) {
          // Fast path for click listeners (which is most often) to avoid
          // iterating through props.
          patchProp(el, 'onClick', props.onClick, null)
        }
        // vnode hooks
        const { onVnodeBeforeMount, onVnodeMounted } = props
        if (onVnodeBeforeMount != null) {
          invokeDirectiveHook(onVnodeBeforeMount, parentComponent, vnode)
        }
        if (onVnodeMounted != null) {
          queuePostFlushCb(() => {
            invokeDirectiveHook(onVnodeMounted, parentComponent, vnode)
          })
        }
      }
      // children
      if (
        vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN &&
        // skip if element has innerHTML / textContent
        !(props !== null && (props.innerHTML || props.textContent))
      ) {
        hydrateChildren(
          el.firstChild,
          vnode.children as VNode[],
          parentComponent
        )
      }
    }
    return el.nextSibling
  }

  function hydrateChildren(
    node: Node | null | undefined,
    vnodes: VNode[],
    parentComponent: ComponentInternalInstance | null
  ): Node | null | undefined {
    for (let i = 0; node != null && i < vnodes.length; i++) {
      // TODO can skip normalizeVNode in optimized mode
      // (need hint on rendered markup?)
      const vnode = (vnodes[i] = normalizeVNode(vnodes[i]))
      node = hydrateNode(node, vnode, parentComponent)
    }
    return node
  }

  return [hydrate, hydrateNode] as const
}
