import { ComponentInstance } from './component'
import { observable } from '@vue/observer'

const internalRE = /^_|^\$/

export function initializeState(instance: ComponentInstance) {
  const { data } = instance.$options
  const rawData = (instance._rawData = (data ? data.call(instance) : {}) as any)
  extractInitializers(instance, rawData)
  instance.$data = observable(rawData || {})
}

// extract properties initialized in a component's constructor
export function extractInitializers(
  instance: ComponentInstance,
  data: any = {}
): any {
  const keys = Object.keys(instance)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (!internalRE.test(key)) {
      data[key] = (instance as any)[key]
    }
  }
  return data
}
