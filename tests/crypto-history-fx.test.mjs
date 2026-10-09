import assert from 'node:assert/strict'
import {before,after,afterEach,test} from 'node:test'
import {createServer} from 'vite'
let server,q,p,f,m,h,s,y,c
const original=globalThis.fetch
before(async()=>{
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;[q,p,f,m,h,s,y,c]=await Promise.all(['src/quantityHistory','src/priceHistory','src/historicalFx','src/model','src/history','src/saveState','server/yahoo','src/currencies'].map(x=>server.ssrLoadModule(`/${x}.ts`)))
})
afterEach(()=>{globalThis.fetch=original;p.clearHistoryCache()})
after(()=>server.close())
const date='2026-09-01',stamp=date+'T12:00:00Z'
const entry=(over={})=>({accountId:'synthetic',account:'合成測試帳戶',category:'加密貨幣',country:'GLOBAL',type:'cash',symbol:'',currency:'USDT',quantity:7,...over})
const quote=(symbol,currency,close,day=date)=>({symbol,currency,asTraded:true,splits:[],points:[{date:day,close}]})
const fixture=()=>({...m.emptyData(),accounts:[{id:'synthetic',name:'合成測試帳戶',category:'加密貨幣',country:'GLOBAL',kind:'investment',positions:[{id:'cash',type:'cash',symbol:'',currency:'USDT',quantity:7,price:1,addedAt:'2026-08-31T12:00:00Z'}]}],fxRates:{USDT:999}})
const provider=async symbol=>symbol==='TWD=X'?quote(symbol,'TWD',32):quote(symbol,'USD',0.98)
test('USDT depeg uses two actual quotes, retains both provenance dates and sends only symbols/dates',async()=>{
 const calls=[];const [value]=await q.valueEntries([entry()],date,async(...args)=>{calls.push(args);return provider(args[0])})
 assert.deepEqual(calls.sort(),[['TWD=X',date],['USDT-USD',date]].sort())
 assert.ok(Math.abs(q.entryValue(value)-219.52)<1e-9)
 assert.equal(value.fx.source,'derived');assert.equal(value.fx.value,0.98*32)
 assert.deepEqual(value.fx.legs.map(x=>[x.source,x.symbol,x.currency,x.date]),[['Yahoo','USDT-USD','USD',date],['Yahoo','TWD=X','TWD',date]])
 assert.equal(value.quantity,7)
})
test('all supported crypto currency balances use the shared USD bridge, no fixed peg',async()=>{
 for(const currency of Object.keys(c.CRYPTO_IDS)){
  const calls=[];const [value]=await q.valueEntries([entry({currency})],date,async symbol=>{calls.push(symbol);return symbol==='TWD=X'?quote(symbol,'TWD',30):quote(symbol,'USD',currency==='BTC'?60000:0.97)})
  assert.deepEqual(calls.sort(),[`${currency}-USD`,'TWD=X'].sort());assert.equal(value.fx.legs.length,2)
  assert.ok(Math.abs(q.entryValue(value)-7*(currency==='BTC'?60000:0.97)*30)<1e-8)
 }
})
test('either missing leg, provider errors and currency mismatch remain unknown with specific reasons',async()=>{
 for(const broken of ['USDT-USD','TWD=X']) for(const failure of ['missing','not_found','provider_error','wrong_currency']){
  const [value]=await q.valueEntries([entry()],date,async symbol=>symbol!==broken?provider(symbol):failure==='missing'?null:failure==='wrong_currency'?quote(symbol,'EUR',1):{symbol,currency:'',points:[],failure})
  assert.equal(q.entryValue(value),null);assert.match(value.error,broken==='TWD=X'?/USD\/TWD/:/USDT\/USD/)
  assert.match(value.error,failure==='provider_error'?/來源暫時異常/:failure==='not_found'?/查無行情/:failure==='wrong_currency'?/幣別不符/:/缺少歷史行情/)
 }
})
test('weekend legs retain distinct dates and reject future, stale or unverified quotes independently',async()=>{
 const selected='2026-09-06'
 const fx=await f.fetchHistoricalFx('USDT',selected,async symbol=>symbol==='TWD=X'?quote(symbol,'TWD',32,'2026-09-04'):quote(symbol,'USD',0.98,selected))
 const result=q.quoteOn(fx,selected);assert.deepEqual(result.legs.map(x=>x.date),[selected,'2026-09-04'])
 for(const bad of ['future','stale','unverified','wrong_symbol'])for(const broken of ['TWD=X','USDT-USD']){
  const chain=await f.fetchHistoricalFx('USDT',selected,async symbol=>{
   const value=await provider(symbol);value.points[0].date=symbol!==broken?selected:bad==='future'?'2026-09-07':bad==='stale'?'2026-08-29':selected
   if(symbol===broken&&bad==='unverified')value.asTraded=false
   if(symbol===broken&&bad==='wrong_symbol')value.symbol='OTHER-USD'
   return value
  });assert.equal(q.quoteOn(chain,selected),undefined)
 }
})
test('zero/unknown skip queries and noncrypto currencies retain their existing route',async()=>{
 let calls=0
 const rows=await q.valueEntries([entry({quantity:0}),entry({quantity:null}),entry({currency:'TWD',quantity:20})],date,async()=>{calls++;return null})
 assert.equal(calls,0);assert.deepEqual(rows.map(q.entryValue),[0,null,20])
 const symbols=[];const [usd]=await q.valueEntries([entry({currency:'USD'})],date,async symbol=>{symbols.push(symbol);return quote(symbol,'TWD',32)})
 assert.deepEqual(symbols,['USDTWD=X']);assert.equal(q.entryValue(usd),224)
})
test('daily valuation shares leg queries and agrees with both historical and legacy position timelines',async()=>{
 const data=fixture(),calls=[]
 data.history.quantityDays=[{date,updatedAt:stamp,entries:[entry()]},{date:'2026-09-02',updatedAt:stamp,entries:[entry({quantity:5})]}]
 const valued=await q.valueDays(data.history.quantityDays,async(symbol,from)=>{calls.push([symbol,from]);return provider(symbol)})
 assert.equal(calls.length,2)
 const fx=await f.fetchHistoricalFx('USDT',date,provider)
 const positions=p.positionTimeline(data,data.accounts[0],data.accounts[0].positions[0],null,fx,'2026-09-03T12:00:00Z').days
 const totals=h.totalPoints({...data,history:{...data.history,valuedQuantityDays:valued}},'2026-09-03T12:00:00Z')
 for(const day of valued){assert.equal(positions.find(x=>x.date===day.date).value,q.quantityPoint(day).total);assert.equal(totals.find(x=>x.date===day.date).total,q.quantityPoint(day).total)}
 const legacy=fixture();const days=p.positionTimeline(legacy,legacy.accounts[0],legacy.accounts[0].positions[0],null,fx,'2026-09-03T12:00:00Z').days
 assert.ok(Math.abs(days.find(x=>x.date===date).value-219.52)<1e-9);assert.equal(days.find(x=>x.date===date).rateQuote.legs.length,2)
})
test('derived provenance persists with v7, retains old fields, and cannot be silently downgraded during save',async()=>{
 const data=fixture(),rows=await q.valueEntries([entry()],date,provider)
 const edited=q.applyQuantityDay(data,{date,updatedAt:stamp,sparse:true,entries:rows})
 assert.equal(edited.version,7)
 const round=m.parseWealthData(JSON.parse(JSON.stringify(edited)))
 assert.deepEqual(round.history.quantityDays[0].entries[0].fx,rows[0].fx)
 const saved=h.recordSave(data,{...edited,updatedAt:stamp});assert.equal(saved.version,7)
 assert.equal(s.finishSave({...edited},data,saved).version,7)
 assert.deepEqual(saved.accounts[0].positions.map(x=>x.quantity),[7])
 for(const version of [1,2,3,4,5,6])assert.equal(m.parseWealthData({...data,version}).version,version)
 for(const change of [fx=>fx.legs[0].date='2026-09-02',fx=>fx.legs[1].value=-1,fx=>fx.value=123,fx=>fx.legs[0].symbol='OTHER-USD',fx=>fx.legs[1].currency='USD']){
  const bad=JSON.parse(JSON.stringify(edited.history.quantityDays));change(bad[0].entries[0].fx);assert.throws(()=>q.parseQuantityDays(bad),/換算鏈/)
 }
})
test('API distinguishes upstream outages from not-found, with no caching on outages',async()=>{
 const url=new URL('https://synthetic.invalid/api/history?symbol=USDT-USD&from=2026-09-01')
 for(const status of [429,500,503]){
  globalThis.fetch=async()=>new Response('',{status});const result=await y.handleApiRequest(url)
  assert.equal(result.status,502);assert.deepEqual(await result.json(),{error:'provider_error'});assert.equal(result.headers.get('Cache-Control'),'no-store')
 }
 globalThis.fetch=async()=>new Response('',{status:404});const missing=await y.handleApiRequest(url)
 assert.equal(missing.status,404);assert.deepEqual(await missing.json(),{error:'not_found'})
 globalThis.fetch=async()=>{throw new Error('offline')};assert.equal((await y.handleApiRequest(url)).status,502)
 globalThis.fetch=async()=>new Response('bad JSON',{status:200});assert.equal((await y.handleApiRequest(url)).status,502)
 for(const body of [{},{chart:{result:null}},{chart:{result:[{meta:{currency:'USD'}}]}}]){
  globalThis.fetch=async()=>Response.json(body);assert.equal((await y.handleApiRequest(url)).status,502)
 }
 globalThis.fetch=async()=>Response.json({chart:{result:[]}});assert.equal((await y.handleApiRequest(url)).status,404)
})
test('client retains failure kind and does not accept injected conversion containers from provider',async()=>{
 for(const status of [404,502]){
  globalThis.fetch=async()=>new Response('{}',{status});const result=await p.fetchHistory('USDT-USD',date,true)
  assert.equal(result.failure,status===404?'not_found':'provider_error')
 }
 globalThis.fetch=async()=>Response.json({...quote('USDT-USD','USD',0.98),conversion:{currency:'USDT',asset:null,usd:null}})
 assert.equal((await p.fetchHistory('USDT-USD',date,true)).conversion,undefined)
})
