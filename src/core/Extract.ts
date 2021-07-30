import { basename, extname } from 'path'
import { TextDocument, window } from 'vscode'
import { nanoid } from 'nanoid'
import limax from 'limax'
import { Config, Global } from '../extension'
import { ExtractInfo } from './types'
import { CurrentFile } from './CurrentFile'
import { changeCase } from '~/utils/changeCase'
import { Translator as TranslateEngine } from '~/translators'


export function generateKeyFromText(text: string, filepath?: string, reuseExisting = false, usedKeys: string[] = []): string {
  let key: string | undefined

  // already existed, reuse the key
  // mostly for auto extraction
  if (reuseExisting) {
    key = Global.loader.searchKeyForTranslations(text)
    if (key)
      return key
  }
  const keygenStrategy = Config.keygenStrategy
  if (keygenStrategy === 'random') {
    key = nanoid()
  }
  else if (keygenStrategy === 'empty') {
    key = ''
  }
  else {
    text = text.replace(/\$/g, '')
    // Config.preferredDelimiter
    key = limax(text, { separator: '__', tone: true })
      .slice(0, Config.extractKeyMaxLength ?? Infinity)
  }


  const keyPrefix = Config.keyPrefix
  if (keyPrefix && keygenStrategy !== 'empty')
    key = keyPrefix + key

  if (filepath && key.includes('fileName')) {
    key = key
      .replace('{fileName}', basename(filepath))
      .replace('{fileNameWithoutExt}', basename(filepath, extname(filepath)))
  }

  // 修改字符串显示
  key = changeCase(key, Config.keygenStyle).trim()

  // some symbol can't convert to alphabet correctly, apply a default key to it
  if (!key)
    key = 'key'

  // suffix with a auto increment number if same key
  if (usedKeys.includes(key) || CurrentFile.loader.getNodeByKey(key)) {
    const originalKey = key
    let num = 0

    do {
      key = `${originalKey}${Config.preferredDelimiter}${num}`
      num += 1
    } while (
      usedKeys.includes(key) || CurrentFile.loader.getNodeByKey(key, false)
    )
  }

  return key
}


async function translateText(text:string) {
  let key = ''
  let trans_result:any = {}
  const engines = Config.translateEngines || ['google']
  const extractTranslateSourceLanguage = Config.extractTranslateSourceLanguage || 'auto'
  const extractTranslateTargetLanguage = Config.extractTranslateTargetLanguage || 'auto'

  try {
    const _translator = new TranslateEngine()
     trans_result = await  _translator.translate({ engine: engines[0], text, from: extractTranslateSourceLanguage, to: extractTranslateTargetLanguage })
    if (trans_result.error) {
      throw trans_result.error
    }

  } catch (e) {
    console.log('error',e)
  }
  console.log('翻译后结果',trans_result?.result)
  
  if (trans_result && trans_result.result && trans_result.result.length > 0) {
    key = trans_result.result[0]
  }
  return key
}

// 翻译要用promise 请求接口返回
export async function generatePromiseKeyFromText(text: string, filepath?: string, reuseExisting = false, usedKeys: string[] = []): Promise<string>{
  let key: string | undefined

  // already existed, reuse the key
  // mostly for auto extraction
  if (reuseExisting) {
    key = Global.loader.searchKeyForTranslations(text)
    if (key)
      return key
  }
  
  const keygenStrategy = Config.keygenStrategy
  if (keygenStrategy === 'random') {
    key = nanoid()
  }
  else if (keygenStrategy === 'empty') {
    key = ''
  }
  else if (keygenStrategy === 'translation') {
    key  = await translateText(text)
  }
  else {
    text = text.replace(/\$/g, '')
    // Config.preferredDelimiter  __
    key = limax(text, { separator: Config.preferredDelimiter, tone: false })
      .slice(0, Config.extractKeyMaxLength ?? Infinity)
  }

  if (/[a-z|A-z|\d|\s|-]/g.test(key)) {
    key = changeCase(key, Config.keygenStyle).trim()
  }

  console.log('key',key)

  const keyPrefix = Config.keyPrefix
  if (keyPrefix && keygenStrategy !== 'empty')
    key = keyPrefix + key

  if (filepath && key.includes('fileName')) {
    key = key
      .replace('{fileName}', basename(filepath))
      .replace('{fileNameWithoutExt}', basename(filepath, extname(filepath)))
  }


  // some symbol can't convert to alphabet correctly, apply a default key to it
  if (!key)
    key = 'key'

  // suffix with a auto increment number if same key
  if (usedKeys.includes(key) || CurrentFile.loader.getNodeByKey(key)) {
    const originalKey = key
    let num = 0

    do {
      key = `${originalKey}${Config.preferredDelimiter}${num}`
      num += 1
    } while (
      usedKeys.includes(key) || CurrentFile.loader.getNodeByKey(key, false)
    )
  }

  return key
}

export async function extractHardStrings(document: TextDocument, extracts: ExtractInfo[], saveFile = false) {
  if (!extracts.length)
    return

  const editor = await window.showTextDocument(document)
  const filepath = document.uri.fsPath
  const sourceLanguage = Config.sourceLanguage

  console.log(editor, filepath)

  extracts.sort((a, b) => b.range.start.compareTo(a.range.start))

  await Promise.all(
    [
      // replace
      editor.edit((editBuilder) => {
        for (const extract of extracts) {
          editBuilder.replace(
            extract.range,
            extract.replaceTo,
          )
        }
      }),
      // save keys
      CurrentFile.loader.write(
        extracts
          .filter(i => i.keypath != null && i.message != null)
          .map(e => ({
            textFromPath: filepath,
            filepath: undefined,
            keypath: e.keypath!,
            value: e.message!,
            locale: e.locale || sourceLanguage,
          })),
      ),
    ],
  )

  if (saveFile)
    await document.save()

  CurrentFile.invalidate()
}
