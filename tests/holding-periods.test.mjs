import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {createServer} from 'vite'
let server,p,q,m,h,s,t
before(async()=>{
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;[p,q,m,h,s,t]=await Promise.all(['holdingPeriods','quantityHistory','model','history','saveState','priceHistory'].map(n=>server.ssrLoadModule(`/src/${n}.ts`)))
})
after(()=>server.close())
const now='2026-10-09T12:00:00Z'
const identity={accountId:'a',account:'合成帳戶',category:'股票',country:'TW',type:'holding',symbol:'TEST',currency:'TWD'}
const period=(over={})=>({...identity,id:'p1',updatedAt:now,start:'2026-09-01',end:'2026-10-02',quantity:10,timeZone:'Asia/Taipei',...over})
const fixture=()=>({...m.emptyData(),accounts:[{id:'a',name:'合成帳戶',kind:'investment',category:'股票',country:'TW',positions:[{id:'pos',type:'holding',symbol:'TEST',currency:'TWD',quantity:99,price:10}]}]})
const withPeriod=(over={})=>{const d=fixture();d.version=5;d.history.holdingPeriods=[period(over)];return d}
const count=(d,date)=>p.periodQuantityOn(d,identity,date)?.quantity
const explicit=(date,quantity)=>({date,updatedAt:now,entries:[{...identity,quantity}]})
const change=(at,before,after)=>({...identity,at,before,after})
const prices=()=>({symbol:'TEST',currency:'TWD',asTraded:true,splits:[],points:[{date:'2026-10-01',close:10},{date:'2026-10-02',close:10},{date:'2026-10-05',close:10},{date:'2026-10-08',close:10}]})
test('period start inclusive / end exclusive; ended means zero and later rebuy resumes',()=>{
 const d=withPeriod();assert.equal(count(d,'2026-08-31'),undefined)
 assert.equal(count(d,'2026-09-01'),10);assert.equal(count(d,'2026-10-01'),10);assert.equal(count(d,'2026-10-02'),0);assert.equal(count(d,'2026-10-08'),0)
 d.history.quantityDays=[explicit('2026-10-05',3)]
 assert.equal(count(d,'2026-10-04'),0);assert.equal(count(d,'2026-10-05'),3);assert.equal(count(d,'2026-10-08'),3)
 const rows=p.expandPeriodDays(d,now);assert.equal(rows.at(-1).date,'2026-10-08');assert.equal(d.accounts[0].positions[0].quantity,99)
 assert.equal(p.periodQuantityOn(d,{...identity,accountId:'b'},'2026-10-01'),undefined)
})
test('ongoing baseline preserves explicit daily values, unknowns and quantity logs, ignores price-only logs',()=>{
 const d=withPeriod({end:undefined});d.history.quantityDays=[explicit('2026-09-05',4),explicit('2026-10-06',null)]
 d.history.changes=[change('2026-10-01T12:00:00Z',{quantity:4,price:1},{quantity:4,price:9}),change('2026-10-03T12:00:00Z',{quantity:4,price:9},{quantity:6,price:9})]
 assert.equal(count(d,'2026-10-01'),4);assert.equal(count(d,'2026-10-03'),6);assert.equal(count(d,'2026-10-07'),null)
 d.history.quantityDays.push(explicit('2026-09-01',2));assert.equal(count(d,'2026-09-01'),2)
 d.history.holdingPeriods[0].end='2026-10-02';d.history.quantityDays.push(explicit('2026-10-02',8));assert.equal(count(d,'2026-10-02'),8)
})
test('overlap needs confirmation, later start retires old end; original records remain recoverable',()=>{
 const d=withPeriod();const nextPeriod=period({id:'p2',start:'2026-09-20',end:'2026-10-06',quantity:20})
 assert.throws(()=>p.applyHoldingPeriod(d,nextPeriod,p.periodRevision(d),false,now),/確認/)
 const next=p.applyHoldingPeriod(d,nextPeriod,p.periodRevision(d),true,now)
 assert.equal(count(next,'2026-09-19'),10);assert.equal(count(next,'2026-10-02'),20);assert.equal(count(next,'2026-10-06'),0)
 assert.equal(d.history.holdingPeriods.length,1);assert.deepEqual(next.history.holdingPeriods[0],d.history.holdingPeriods[0])
 const same=p.applyHoldingPeriod(next,period({id:'p3',start:'2026-09-20',end:undefined,quantity:30}),p.periodRevision(next),true,now)
 assert.equal(count(same,'2026-10-07'),30)
 const removed={...same,history:{...same.history,holdingPeriods:same.history.holdingPeriods.filter(x=>x.id!=='p3')}}
 assert.equal(count(removed,'2026-10-07'),0)
 assert.throws(()=>p.applyHoldingPeriod(next,period({id:'p4'}),p.periodRevision(d),true,now),/重新預覽/)
})
test('date, quantity, timezone, schema validation and resource bounds',()=>{
 for(const over of [{end:'2026-09-01'},{end:'2026-08-31'},{start:'2026-10-10',end:undefined},{end:'2026-10-10'},{quantity:-1},{quantity:NaN},{quantity:Infinity},{quantity:null},{timeZone:'Invalid/Zone'},{start:'2010-01-01'},{start:'2025-02-29'}]) assert.throws(()=>p.validatePeriodInput(period(over),now),JSON.stringify(over))
 assert.doesNotThrow(()=>p.validatePeriodInput(period({start:'2024-02-29',quantity:0.25}),now))
 assert.doesNotThrow(()=>p.validatePeriodInput(period({start:'2026-10-09',end:undefined,timeZone:'Asia/Tokyo'}),'2026-10-08T16:00:00Z'))
 assert.throws(()=>p.validatePeriodInput(period({start:'2026-10-09',end:undefined,timeZone:'America/Los_Angeles'}),'2026-10-08T16:00:00Z'))
 assert.throws(()=>p.parseHoldingPeriods([period(),period({id:'p2',timeZone:'UTC'})]),/相同日曆時區/)
 assert.throws(()=>p.parseHoldingPeriods([period(),period()]))
 const d=withPeriod({start:'2010-01-01'});assert.equal(p.expandPeriodDays(d,now).length,p.MAX_PERIOD_DAYS)
 d.accounts[0].positions=Array.from({length:15},(_,i)=>({...d.accounts[0].positions[0],id:`pos${i}`,symbol:`TEST${i}`}))
 assert.throws(()=>p.expandPeriodDays(d,now),/50,000/)
})
test('stored IANA timezone assigns trade instants consistently over DST',()=>{
 const d=withPeriod({start:'2026-03-01',end:undefined,timeZone:'America/New_York'})
 d.history.changes=[change('2026-03-08T04:30:00Z',null,{quantity:4,price:1}),change('2026-03-09T03:30:00Z',null,{quantity:7,price:1})]
 assert.equal(count(d,'2026-03-07'),4);assert.equal(count(d,'2026-03-08'),7)
 const zone=process.env.TZ
 try{for(const tz of ['UTC','Asia/Taipei','America/Los_Angeles']){process.env.TZ=tz;assert.equal(count(d,'2026-03-08'),7);assert.equal(p.shiftDate('2026-03-08',1),'2026-03-09')}}finally{if(zone===undefined)delete process.env.TZ;else process.env.TZ=zone}
})
test('split adjustment, weekends and zero agree between position chart and shared totals',async()=>{
 const d=withPeriod({start:'2026-10-01',end:'2026-10-08'})
 const quote=prices();quote.splits=[{date:'2026-10-05',ratio:2}];quote.points=quote.points.map(x=>({...x,close:x.date>='2026-10-05'?5:10}))
 const days=await q.valueDays(p.expandPeriodDays(d,now),async()=>quote)
 const timeline=t.positionTimeline(d,d.accounts[0],d.accounts[0].positions[0],quote,null,now).days
 for(const day of days){const chart=timeline.find(x=>x.date===day.date);assert.equal(q.quantityPoint(day).total,chart.value,day.date);assert.equal(day.entries[0].quantity,chart.quantity,day.date)}
 assert.equal(days.find(x=>x.date==='2026-10-04').entries[0].quantity,10)
 assert.equal(days.find(x=>x.date==='2026-10-05').entries[0].quantity,20)
 assert.equal(days.find(x=>x.date==='2026-10-08').entries[0].quantity,0)
 const totals=h.totalPoints({...d,history:{...d.history,valuedQuantityDays:days}},now)
 assert.equal(totals.find(x=>x.date==='2026-10-05').total,100)
 assert.equal(totals.find(x=>x.date==='2026-10-08').total,0)
 assert.equal(totals.at(-1).total,990)
 const missing=await q.valueDays(p.expandPeriodDays(d,now),async()=>null)
 assert.equal(q.quantityPoint(missing[0]).total,null);assert.equal(q.quantityPoint(missing.at(-1)).total,0)
 assert.equal(d.history.holdingPeriods[0].quantity,10)
})
test('uncovered accounts keep totals unknown and do not inherit a different account period',async()=>{
 const d=withPeriod({start:'2026-10-01'});d.accounts.push({...d.accounts[0],id:'b'})
 const days=await q.valueDays(p.expandPeriodDays(d,now),async()=>prices())
 assert.equal(days[0].entries.find(e=>e.accountId==='b').quantity,null)
 assert.equal(q.quantityPoint(days[0]).total,null)
 assert.equal(q.quantityPoint({...days[0],entries:[days[0].entries[0]]},{liabilityTotal:50,liabilityEstimated:true,accounts:[]}).netWorth,50)
})
test('v1–v5 round trips and save races retain raw intervals without persisting generated dates',()=>{
 for(const version of [1,2,3,4])assert.equal(m.parseWealthData({...fixture(),version}).version,version)
 const d=withPeriod();d.history.quantityDays=[explicit('2026-09-04',8)]
 assert.deepEqual(m.parseWealthData(JSON.parse(JSON.stringify(d))).history.holdingPeriods,d.history.holdingPeriods)
 const saved=h.recordSave(null,{...d,history:{...d.history,valuedQuantityDays:p.expandPeriodDays(d,now)}})
 assert.equal(saved.version,5);assert.equal(saved.history.valuedQuantityDays,undefined);assert.equal(saved.history.quantityDays.length,1)
 const current=p.applyHoldingPeriod(d,period({id:'p2',start:'2026-10-03',end:undefined}),p.periodRevision(d),true,now)
 const merged=s.finishSave(current,d,saved)
 assert.deepEqual(merged.history.holdingPeriods,current.history.holdingPeriods);assert.equal(merged.history.snapshots,saved.history.snapshots);assert.equal(merged.version,5)
 assert.deepEqual(merged.accounts.map(a=>a.positions.map(x=>x.quantity)),[[99]])
})
