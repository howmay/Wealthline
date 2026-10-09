import assert from 'node:assert/strict'
import {after,before,test} from 'node:test'
import {createServer} from 'vite'
let server,q,h,m,save,timeline,yahoo
before(async()=>{
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 q=await server.ssrLoadModule('/src/quantityHistory.ts');h=await server.ssrLoadModule('/src/history.ts');m=await server.ssrLoadModule('/src/model.ts');save=await server.ssrLoadModule('/src/saveState.ts');timeline=await server.ssrLoadModule('/src/priceHistory.ts');yahoo=await server.ssrLoadModule('/server/yahoo.ts')
})
after(()=>server.close())
const instrument=(over={})=>({accountId:'synthetic-a',account:'合成帳戶',category:'股票',country:'US',type:'holding',symbol:'TEST',currency:'USD',...over})
const entry=(over={})=>({...instrument(),quantity:2,...over})
const day=(over={})=>({date:'2025-10-04',updatedAt:'2025-10-06T12:00:00Z',entries:[entry()],...over})
const quote=(symbol,currency,close=10)=>({symbol,currency,asTraded:true,splits:[],points:[{date:'2025-10-03',close},{date:'2025-10-06',close:999}]})
const fixture=()=>({...m.emptyData(),accounts:[{id:'synthetic-a',name:'合成帳戶',kind:'investment',category:'股票',country:'US',positions:[{id:'batch1',type:'holding',symbol:'TEST',currency:'USD',quantity:3,price:900},{id:'batch2',type:'holding',symbol:'TEST',currency:'USD',quantity:4,price:800}]}],fxRates:{USD:999}})
test('group key includes account and currency; lots aggregate and old unknown quantities stay unknown',()=>{
 const data=fixture();data.accounts.push({...data.accounts[0],id:'synthetic-b'})
 assert.equal(q.historyCatalog(data).length,2)
 assert.notEqual(q.instrumentKey(entry()),q.instrumentKey(entry({accountId:'synthetic-b'})))
 assert.notEqual(q.instrumentKey(entry()),q.instrumentKey(entry({currency:'TWD'})))
 assert.ok(q.entriesForDate(data,'2025-10-04').every(e=>e.quantity===null))
 data.history.changes=[{at:'2025-10-04T12:00:00Z',accountId:'synthetic-a',account:'合成帳戶',type:'holding',symbol:'TEST',currency:'USD',before:null,after:{quantity:8,price:1}},{at:'2025-10-04T13:00:00Z',accountId:'synthetic-a',account:'合成帳戶',type:'holding',symbol:'TEST',currency:'USD',before:{quantity:8,price:1},after:{quantity:6,price:1}}]
 assert.equal(q.entriesForDate(data,'2025-10-04').find(e=>e.accountId==='synthetic-a').quantity,6)
 assert.equal(q.entriesForDate(data,'2025-10-03')[0].quantity,null)
 assert.equal(q.entriesForDate(data,'2025-10-05')[0].quantity,null)
})
test('valuation uses prior completed close and historical FX; requests contain only market identifiers/date',async()=>{
 const calls=[]
 const fetcher=async(...args)=>{calls.push(args);return args[0]==='USDTWD=X'?quote('USDTWD=X','TWD',30):quote('TEST','USD',10)}
 const rows=await q.valueEntries([entry(),entry({accountId:'synthetic-b',quantity:5})],'2025-10-04',fetcher)
 assert.equal(q.entryValue(rows[0]),600);assert.equal(q.entryValue(rows[1]),1500)
 assert.equal(rows[0].price.date,'2025-10-03');assert.equal(rows[0].fx.date,'2025-10-03')
 assert.deepEqual(calls.sort(),[['TEST','2025-10-04'],['USDTWD=X','2025-10-04']].sort())
 assert.equal(q.quoteOn(quote('TEST','USD'),'2025-10-02'),undefined)
 assert.equal(q.quoteOn(quote('TEST','USD'),'2025-10-14'),undefined)
})
test('missing, wrong-currency, future-only, unverified prices, zero and unknown never use present rates',async()=>{
 for(const source of [null,{...quote('TEST','EUR')},{...quote('TEST','USD'),asTraded:false},{...quote('TEST','USD'),points:[{date:'2025-10-06',close:3}]}]) {
  const [e]=await q.valueEntries([entry()],'2025-10-04',async()=>source)
  assert.equal(q.entryValue(e),null);assert.ok(e.error)
 }
 let calls=0
 const zero=await q.valueEntries([entry({quantity:0}),entry({quantity:null}),entry({type:'cash',symbol:'',currency:'TWD',quantity:25})],'2025-10-04',async()=>{calls++;return null})
 assert.equal(calls,0);assert.deepEqual(zero.map(q.entryValue),[0,null,25])
 const cash=(await q.valueEntries([entry({type:'cash',symbol:'',quantity:25})],'2025-10-04',async()=>quote('USDTWD=X','TWD',30)))[0]
 assert.equal(q.entryValue(cash),750)
})
test('date/quantity/identity validation rejects invalid, duplicate and future entries; date strings are stable',()=>{
 for(const date of ['2025-02-29','2025-13-01','bad','0000-01-01']) assert.throws(()=>q.validatePastDate(date,'2026-10-09T12:00:00Z'))
 assert.throws(()=>q.validatePastDate('2026-10-10','2026-10-09T12:00:00Z'),/未來/)
 assert.doesNotThrow(()=>q.validatePastDate('2024-02-29','2026-10-09T12:00:00Z'))
 for(const quantity of [-1,NaN,Infinity,'1',undefined])assert.throws(()=>q.parseQuantityDays([day({entries:[entry({quantity})]})]))
 assert.throws(()=>q.parseQuantityDays([day(),day()]),/日期不可重複/)
 assert.throws(()=>q.parseQuantityDays([day({entries:[entry(),entry()]})]),/不可重複/)
 assert.throws(()=>q.parseQuantityDays([day({entries:[entry({fx:{source:'Yahoo',symbol:'USDTWD=X',date:'2025-10-06',value:30}})]})]),/日期/)
 assert.equal(q.parseQuantityDays([day()])[0].date,'2025-10-04')
})
test('manual days override history only, preserve unknown debt, order dates and never silently replace existing edits',()=>{
 const data=fixture();data.history.snapshots=[{date:'2025-10-04',at:'2025-10-04T12:00:00Z',total:999,accounts:[{id:'synthetic-a',name:'合成帳戶',value:999}],categories:{股票:999}}]
 const manual=day({entries:[entry({type:'cash',symbol:'',currency:'TWD',quantity:100})]})
 const next=q.applyQuantityDay(data,manual)
 assert.equal(next.accounts,data.accounts);assert.equal(next.liabilities,data.liabilities);assert.equal(next.version,3)
 assert.equal(h.totalPoints(next,'2025-10-08T12:00:00Z')[0].total,100)
 assert.equal(h.totalPoints(next,'2025-10-08T12:00:00Z')[0].netWorth,undefined)
 assert.throws(()=>q.applyQuantityDay(next,manual),/已新增或變更/)
 const corrected=q.applyQuantityDay(next,{...manual,entries:[entry({type:'cash',symbol:'',currency:'TWD',quantity:50})]},next.history.quantityDays[0])
 assert.equal(h.totalPoints(corrected,'2025-10-08T12:00:00Z')[0].total,50)
 const original={...data.history.snapshots[0],liabilityTotal:150,netWorth:849}
 assert.equal(q.quantityPoint(manual,original).netWorth,-50)
 assert.equal(q.quantityPoint(day(),original).total,null)
 assert.equal(q.quantityPoint(day(),original).netWorth,null)
 const removed={...corrected,history:{...corrected.history,quantityDays:[]}}
 assert.equal(h.totalPoints(removed,'2025-10-08T12:00:00Z')[0].total,999)
})
test('same-day automatic saves preserve manual records and async history edit retains committed logs',()=>{
 const data=fixture();const now=new Date().toISOString(),date=h.localDate(now)
 const submitted=q.applyQuantityDay(data,day({date,entries:[entry({quantity:0})]}))
 const persisted=h.recordSave(data,{...submitted,updatedAt:now})
 assert.equal(persisted.version,3);assert.deepEqual(persisted.history.quantityDays,submitted.history.quantityDays)
 assert.equal(persisted.history.snapshots.some(s=>s.date===date),false)
 assert.equal(h.totalPoints(persisted,now).find(s=>s.date===date).total,0)
 const current=q.applyQuantityDay(submitted,day({date,entries:[entry({quantity:null})]}),submitted.history.quantityDays[0])
 const finished=save.finishSave(current,submitted,persisted)
 assert.equal(finished.history.quantityDays,current.history.quantityDays)
 assert.equal(finished.history.changes,persisted.history.changes)
 assert.equal(finished.accounts[0].positions[0].quantity,3)
 assert.equal(h.totalPoints(finished,now).find(s=>s.date===date).total,null)
 assert.deepEqual(m.parseWealthData(JSON.parse(JSON.stringify(persisted))).history.quantityDays,persisted.history.quantityDays)
})
test('duplicate current account/position IDs reject; old schemas remain readable without invented quantity history',()=>{
 const data=fixture();assert.equal(m.parseWealthData(data).history.quantityDays,undefined)
 const v1={...data,version:1};delete v1.liabilities;assert.equal(m.parseWealthData(v1).version,1)
 assert.throws(()=>m.parseWealthData({...data,accounts:[data.accounts[0],data.accounts[0]]}),/識別碼重複/)
 assert.throws(()=>m.parseWealthData({...data,accounts:[{...data.accounts[0],positions:[data.accounts[0].positions[0],data.accounts[0].positions[0]]}]}),/識別碼重複/)
})
test('Yahoo normalizes historical split units, uses exchange timezone, and excludes unfinished daily candles',async()=>{
 const original=globalThis.fetch;let url
 globalThis.fetch=async u=>{url=u;return Response.json({chart:{result:[{meta:{currency:'USD',symbol:'TEST',exchangeTimezoneName:'America/New_York'},timestamp:[Date.parse('2025-03-07T14:30:00Z')/1000,Date.parse('2025-03-10T13:30:00Z')/1000],indicators:{quote:[{close:[25,30]}]},events:{splits:{s:{date:Date.parse('2025-03-10T13:30:00Z')/1000,numerator:4,denominator:1}}}}]}})}
 try{const result=await yahoo.yahooHistory('TEST','2025-03-07');assert.deepEqual(result.points,[{date:'2025-03-07',close:100},{date:'2025-03-10',close:30}]);assert.equal(result.asTraded,true);assert.match(url,/events=splits/);assert.equal(q.quoteOn({...result,points:[result.points[0]]},'2025-03-10'),undefined)}finally{globalThis.fetch=original}
})
test('position timeline aggregates lots, uses explicit day and never uses current FX for the past',()=>{
 const data=fixture(),account=data.accounts[0],p=account.positions[0]
 data.history.changes=[{at:'2025-10-03T12:00:00Z',accountId:account.id,account:account.name,type:'holding',symbol:'TEST',currency:'USD',before:null,after:{quantity:7,price:123}}]
 const result=timeline.positionTimeline(data,account,p,quote('TEST','USD'),null,'2025-10-07T12:00:00Z')
 assert.ok(result.days.filter(d=>!d.live).every(d=>d.value===null))
 assert.equal(result.days.at(-1).quantity,7)
 data.history.quantityDays=[day({entries:[entry({quantity:0})]})]
 assert.equal(timeline.positionTimeline(data,account,p,null,null,'2025-10-07T12:00:00Z').days.find(d=>d.date==='2025-10-04').value,0)
})

test('explicit calendar dates survive timezone changes and saved valuations do not leak into a new day',()=>{
 const data=fixture()
 data.history.quantityDays=[day({entries:[entry({price:{source:'Yahoo',symbol:'TEST',date:'2025-10-03',value:10},fx:{source:'Yahoo',symbol:'USDTWD=X',date:'2025-10-03',value:30}})]})]
 const originalZone=process.env.TZ
 try{for(const zone of ['Pacific/Kiritimati','America/Los_Angeles','Asia/Taipei']){process.env.TZ=zone;assert.equal(m.parseWealthData(JSON.parse(JSON.stringify({...data,version:3}))).history.quantityDays[0].date,'2025-10-04')}}finally{if(originalZone===undefined)delete process.env.TZ;else process.env.TZ=originalZone}
 const next=q.entriesForDate(data,'2025-01-01')[0]
 assert.equal(next.quantity,null);assert.equal(next.price,undefined);assert.equal(next.fx,undefined)
})
test('editing quantity history during a v2 save never downgrades the v3 in-memory document',()=>{
 const before=fixture(),persisted=h.recordSave(before,{...before,updatedAt:new Date().toISOString()})
 const current=q.applyQuantityDay(before,day({entries:[entry({quantity:0})]}))
 const result=save.finishSave(current,before,persisted)
 assert.equal(persisted.version,2);assert.equal(result.version,3)
 assert.equal(result.history.quantityDays,current.history.quantityDays)
 assert.equal(result.history.snapshots,persisted.history.snapshots)
})
test('incomplete portfolios, overflow and uncovered legacy accounts cannot appear as complete totals',()=>{
 const a=entry({type:'cash',symbol:'',currency:'TWD',quantity:50}),unknown=entry({accountId:'other',quantity:null})
 assert.equal(q.quantityPoint(day({entries:[a,unknown]})).total,null)
 assert.equal(q.quantityPoint(day({entries:[a]}),{date:'2025-10-04',at:'2025-10-04',total:500,accounts:[{id:'missing',name:'舊帳戶',value:500}],categories:{}}).total,null)
 assert.equal(q.entryValue(entry({quantity:1e308,price:{value:1e308},fx:{value:30}})),null)
})
test('today incomplete candle is not returned and malformed provider responses fail closed',async()=>{
 const original=globalThis.fetch
 try{
 globalThis.fetch=async()=>Response.json({chart:{result:[{meta:{currency:'USD',symbol:'TEST',exchangeTimezoneName:'UTC'},timestamp:[Math.floor(Date.now()/1000)],indicators:{quote:[{close:[123]}]}}]}})
 assert.deepEqual((await yahoo.yahooHistory('TEST','2025-10-04')).points,[])
 globalThis.fetch=async()=>Response.json({symbol:'TEST',currency:'USD',points:[null]})
 assert.equal(await timeline.fetchHistory('TEST','2025-10-04'),null)
 globalThis.fetch=async()=>new Response('invalid json',{status:200})
 assert.equal(await timeline.fetchHistory('TEST','2025-10-04'),null)
 }finally{globalThis.fetch=original}
})
