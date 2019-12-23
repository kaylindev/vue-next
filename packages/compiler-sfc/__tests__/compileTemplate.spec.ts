import { compileTemplate } from '../src/compileTemplate'
import { parse, SFCTemplateBlock } from '../src/parse'

test('should work', () => {
  const source = `<div><p>{{ render }}</p></div>`

  const result = compileTemplate({ filename: 'example.vue', source })

  expect(result.errors.length).toBe(0)
  expect(result.source).toBe(source)
  // should expose render fn
  expect(result.code).toMatch(`export default function render()`)
})

test('preprocess pug', () => {
  const template = parse(
    `
<template lang="pug">
body
  h1 Pug Examples
  div.container
    p Cool Pug example!
</template>
`,
    { filename: 'example.vue', sourceMap: true }
  ).descriptor.template as SFCTemplateBlock

  const result = compileTemplate({
    filename: 'example.vue',
    source: template.content,
    preprocessLang: template.lang
  })

  expect(result.errors.length).toBe(0)
})

test('warn missing preprocessor', () => {
  const template = parse(`<template lang="unknownLang">hi</template>\n`, {
    filename: 'example.vue',
    sourceMap: true
  }).descriptor.template as SFCTemplateBlock

  const result = compileTemplate({
    filename: 'example.vue',
    source: template.content,
    preprocessLang: template.lang
  })

  expect(result.errors.length).toBe(1)
})

test('transform asset url options', () => {
  const input = { source: `<foo bar="baz"/>`, filename: 'example.vue' }
  // Object option
  const { code: code1 } = compileTemplate({
    ...input,
    transformAssetUrls: { foo: ['bar'] }
  })
  expect(code1).toMatch(`import _imports_0 from 'baz'\n`)
  // false option
  const { code: code2 } = compileTemplate({
    ...input,
    transformAssetUrls: false
  })
  expect(code2).not.toMatch(`import _imports_0 from 'baz'\n`)
})

test('source map', () => {
  const template = parse(
    `
<template>
  <div><p>{{ render }}</p></div>
</template>
`,
    { filename: 'example.vue', sourceMap: true }
  ).descriptor.template as SFCTemplateBlock

  const result = compileTemplate({
    filename: 'example.vue',
    source: template.content
  })

  expect(result.map).toMatchSnapshot()
})

test('template errors', () => {
  const result = compileTemplate({
    filename: 'example.vue',
    source: `<div :foo
      :bar="a[" v-model="baz"/>`
  })
  expect(result.errors).toMatchSnapshot()
})

test('preprocessor errors', () => {
  const template = parse(
    `
<template lang="pug">
  div(class='class)
</template>
`,
    { filename: 'example.vue', sourceMap: true }
  ).descriptor.template as SFCTemplateBlock

  const result = compileTemplate({
    filename: 'example.vue',
    source: template.content,
    preprocessLang: template.lang
  })

  expect(result.errors.length).toBe(1)
  const message = result.errors[0].toString()
  expect(message).toMatch(`Error: example.vue:3:1`)
  expect(message).toMatch(
    `The end of the string reached with no closing bracket ) found.`
  )
})
