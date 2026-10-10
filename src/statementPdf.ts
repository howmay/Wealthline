import { GlobalWorkerOptions, getDocument, PasswordException } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { statementPasswordHandler, textLines } from './statements'

GlobalWorkerOptions.workerSrc = workerUrl
// Bundle CMaps locally: Chinese PDFs must not depend on a CDN or send document data to it.
const maps = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', {eager:true,query:'?url&no-inline',import:'default'}) as Record<string,string>
const fonts = import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {eager:true,query:'?url&no-inline',import:'default'}) as Record<string,string>
class LocalBinaryData {
  async fetch({kind,filename}: {kind:string;filename:string}) {
    const url = kind === 'cMapUrl' ? maps[`/node_modules/pdfjs-dist/cmaps/${filename}`] : kind === 'standardFontDataUrl' ? fonts[`/node_modules/pdfjs-dist/standard_fonts/${filename}`] : undefined
    if(!url) throw new Error('Unsupported PDF character map')
    const response = await fetch(url)
    if(!response.ok) throw new Error('Unable to load character map')
    return new Uint8Array(await response.arrayBuffer())
  }
}

export async function readStatementPdf(bytes: Uint8Array, password:string, signal:AbortSignal): Promise<{lines:string[];title:string}> {
  const task = getDocument({data:new Uint8Array(bytes),password:'',BinaryDataFactory:LocalBinaryData,useWorkerFetch:false,useWasm:false,stopAtErrors:true,verbosity:0})
  task.onPassword = statementPasswordHandler(password)
  const cancel = () => { void task.destroy() }
  signal.addEventListener('abort',cancel,{once:true})
  if(signal.aborted) {cancel();throw new Error('已取消解析')}
  try {
    const pdf = await task.promise
    if(pdf.numPages > 100) throw new Error('帳單超過 100 頁，請拆分後再匯入')
    const lines:string[] = []
    for(let i=1;i<=pdf.numPages;i++) {
      if(signal.aborted) throw new Error('已取消解析')
      const page = await pdf.getPage(i)
      const text = await page.getTextContent()
      lines.push(...textLines(text.items))
      page.cleanup()
      if(lines.join('').length > 500_000) throw new Error('帳單文字過多，請拆分後再匯入')
    }
    if(!lines.length) throw new Error('此 PDF 沒有可讀取的文字。第一版暫不支援掃描／圖片帳單。')
    const metadata = await pdf.getMetadata().catch(()=>null)
    const info = metadata?.info as {Title?:unknown} | undefined
    const title = typeof info?.Title === 'string' ? info.Title : ''
    return {lines,title}
  } catch(e) {
    if(e instanceof PasswordException) throw new Error('帳單需要密碼，或密碼不正確。請重新輸入。')
    throw new Error(e instanceof Error && /帳單|PDF 沒有|已取消/.test(e.message) ? e.message : '無法讀取此 PDF，請確認檔案完整且為支援的文字帳單。')
  } finally {
    signal.removeEventListener('abort',cancel)
    await task.destroy()
  }
}
