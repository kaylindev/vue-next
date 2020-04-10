import { patchProp } from '../../src/patchProp'

const timeout = () => new Promise(r => setTimeout(r))

describe(`events`, () => {
  it('should assign event handler', async () => {
    const el = document.createElement('div')
    const event = new Event('click')
    const fn = jest.fn()
    patchProp(el, 'onClick', null, fn)
    el.dispatchEvent(event)
    await timeout()
    el.dispatchEvent(event)
    await timeout()
    el.dispatchEvent(event)
    await timeout()
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should update event handler', async () => {
    const el = document.createElement('div')
    const event = new Event('click')
    const prevFn = jest.fn()
    const nextFn = jest.fn()
    patchProp(el, 'onClick', null, prevFn)
    el.dispatchEvent(event)
    patchProp(el, 'onClick', prevFn, nextFn)
    await timeout()
    el.dispatchEvent(event)
    await timeout()
    el.dispatchEvent(event)
    await timeout()
    expect(prevFn).toHaveBeenCalledTimes(1)
    expect(nextFn).toHaveBeenCalledTimes(2)
  })

  it('should support multiple event handlers', async () => {
    const el = document.createElement('div')
    const event = new Event('click')
    const fn1 = jest.fn()
    const fn2 = jest.fn()
    patchProp(el, 'onClick', null, [fn1, fn2])
    el.dispatchEvent(event)
    await timeout()
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  it('should unassign event handler', async () => {
    const el = document.createElement('div')
    const event = new Event('click')
    const fn = jest.fn()
    patchProp(el, 'onClick', null, fn)
    patchProp(el, 'onClick', fn, null)
    el.dispatchEvent(event)
    await timeout()
    expect(fn).not.toHaveBeenCalled()
  })

  it('should support event options', async () => {
    const el = document.createElement('div')
    const event = new Event('click')
    const fn = jest.fn()
    const nextValue = {
      handler: fn,
      options: {
        once: true
      }
    }
    patchProp(el, 'onClick', null, nextValue)
    el.dispatchEvent(event)
    await timeout()
    el.dispatchEvent(event)
    await timeout()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should support varying event options', async () => {
    const el = document.createElement('div')
    const event = new Event('click')
    const prevFn = jest.fn()
    const nextFn = jest.fn()
    const nextValue = {
      handler: nextFn,
      options: {
        once: true
      }
    }
    patchProp(el, 'onClick', null, prevFn)
    patchProp(el, 'onClick', prevFn, nextValue)
    el.dispatchEvent(event)
    await timeout()
    el.dispatchEvent(event)
    await timeout()
    expect(prevFn).not.toHaveBeenCalled()
    expect(nextFn).toHaveBeenCalledTimes(1)
  })

  it('should unassign event handler with options', async () => {
    const el = document.createElement('div')
    const event = new Event('click')
    const fn = jest.fn()
    const nextValue = {
      handler: fn,
      options: {
        once: true
      }
    }
    patchProp(el, 'onClick', null, nextValue)
    patchProp(el, 'onClick', nextValue, null)
    el.dispatchEvent(event)
    await timeout()
    el.dispatchEvent(event)
    await timeout()
    expect(fn).not.toHaveBeenCalled()
  })

  it('should support native onclick', async () => {
    const el = document.createElement('div')
    const event = new Event('click')

    // string should be set as attribute
    const fn = ((window as any).__globalSpy = jest.fn())
    patchProp(el, 'onclick', null, '__globalSpy(1)')
    el.dispatchEvent(event)
    await timeout()
    delete (window as any).__globalSpy
    expect(fn).toHaveBeenCalledWith(1)

    const fn2 = jest.fn()
    patchProp(el, 'onclick', '__globalSpy(1)', fn2)
    el.dispatchEvent(event)
    await timeout()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledWith(event)
  })
})
