import {
  ComputedOptions,
  MethodOptions,
  ComponentOptionsWithoutProps,
  ComponentOptionsWithArrayProps,
  ComponentOptionsWithObjectProps,
  ComponentOptionsMixin,
  RenderFunction,
  UnwrapAsyncBindings
} from './componentOptions'
import {
  SetupContext,
  FunctionalComponent,
  AllowedComponentProps,
  ComponentCustomProps
} from './component'
import {
  CreateComponentPublicInstance,
  ComponentPublicInstanceConstructor
} from './componentPublicInstance'
import { ExtractPropTypes, ComponentPropsOptions } from './componentProps'
import { EmitsOptions } from './componentEmits'
import { isFunction } from '@vue/shared'
import { VNodeProps } from './vnode'

// defineComponent is a utility that is primarily used for type inference
// when declaring components. Type inference is provided in the component
// options (provided as the argument). The returned value has artificial types
// for TSX / manual render function / IDE support.

// overload 1: direct setup function
// (uses user defined props interface)
export function defineComponent<Props, RawBindings = object>(
  setup: (
    props: Readonly<Props>,
    ctx: SetupContext
  ) => RawBindings | RenderFunction
): ComponentPublicInstanceConstructor<
  CreateComponentPublicInstance<
    Props,
    UnwrapAsyncBindings<RawBindings>,
    {},
    {},
    {},
    {},
    {},
    {},
    // public props
    VNodeProps & Props & AllowedComponentProps & ComponentCustomProps
  >
> &
  FunctionalComponent<Props>

// overload 2: object format with no props
// (uses user defined props interface)
// return type is for Vetur and TSX support
export function defineComponent<
  Props = {},
  RawBindings = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = Record<string, any>,
  EE extends string = string
>(
  options: ComponentOptionsWithoutProps<
    Props,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE
  >
): ComponentPublicInstanceConstructor<
  CreateComponentPublicInstance<
    Props,
    UnwrapAsyncBindings<RawBindings>,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    VNodeProps & Props & AllowedComponentProps & ComponentCustomProps
  >
> &
  ComponentOptionsWithoutProps<
    Props,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE
  >

// overload 3: object format with array props declaration
// props inferred as { [key in PropNames]?: any }
// return type is for Vetur and TSX support
export function defineComponent<
  PropNames extends string,
  RawBindings,
  D,
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = Record<string, any>,
  EE extends string = string
>(
  options: ComponentOptionsWithArrayProps<
    PropNames,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE
  >
): ComponentPublicInstanceConstructor<
  // array props technically doesn't place any constraints on props in TSX before,
  // but now we can export array props in TSX
  CreateComponentPublicInstance<
    Readonly<{ [key in PropNames]?: any }>,
    UnwrapAsyncBindings<RawBindings>,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    AllowedComponentProps & ComponentCustomProps
  >
> &
  ComponentOptionsWithArrayProps<
    PropNames,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE
  >

// overload 4: object format with object props declaration
// see `ExtractPropTypes` in ./componentProps.ts
export function defineComponent<
  // the Readonly constraint allows TS to treat the type of { required: true }
  // as constant instead of boolean.
  PropsOptions extends Readonly<ComponentPropsOptions>,
  RawBindings,
  D,
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = Record<string, any>,
  EE extends string = string
>(
  options: ComponentOptionsWithObjectProps<
    PropsOptions,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE
  >
): ComponentPublicInstanceConstructor<
  CreateComponentPublicInstance<
    ExtractPropTypes<PropsOptions, false>,
    UnwrapAsyncBindings<RawBindings>,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    VNodeProps & AllowedComponentProps & ComponentCustomProps
  > &
    Readonly<ExtractPropTypes<PropsOptions>>
> &
  ComponentOptionsWithObjectProps<
    PropsOptions,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    EE
  >

// implementation, close to no-op
export function defineComponent(options: unknown) {
  return isFunction(options) ? { setup: options, name: options.name } : options
}
