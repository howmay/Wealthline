import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {createServer} from 'vite'
let server,b,q,p,m,h,t,s
before(async()=>{
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;[b,q,p,m,h,t,s]=await Promise.all(['historyBaseline','quantityHistory','holdingPeriods','model','history','priceHistory','saveState'].map(n=>server.ssrLoadModule(`/src/${n}.ts`)))
})
after(()=>server.close())
const now='2026-10-09T12:00:00Z',date='2026-09-01'
const fixture=()=>{
 const accounts=['A','B','C','D','E'].map((id,i)=>({id,name:`合成帳戶 ${id}`,kind:'investment',country:'US',category:'其他',positions:[{id:`p${id}`,type:id==='B'?'holding':'cash',symbol:id==='B'?'TEST':'',currency:id==='B'?'USD':'TWD',quantity:[100,2,0,3,4][i],price:999}]}))
 const d={...m.emptyData(),version:8,accounts,fxRates:{USD:999}}
 const entries=b.quantityBaselines(d,now)[0].entries
 d.history.quantityDays=[{date:'2026-10-09',updatedAt:now,inventory:{accounts:accounts.map(a=>({id:a.id,name:a.name})),source:{kind:'day',date:'2026-10-08'}},entries}]
 return d
}
const source=d=>b.quantityBaselines(d,now).find(x=>x.id==='day:2026-10-09')
const copy=d=>{const from=source(d);return b.baselineDay(from,date,from.entries.map(e=>({...e,quantity:e.accountId==='A'?e.quantity+200:e.quantity})),now)}
const market=async symbol=>({symbol,currency:symbol==='USDTWD=X'?'TWD':'USD',asTraded:true,splits:[],points:[{date,close:symbol==='USDTWD=X'?30:10},{date:'2026-10-08',close:symbol==='USDTWD=X'?40:100}]})
test('later complete quantity source backfills A difference, preserves B–E and uses destination prices and FX',async()=>{
 const d=fixture(),original=JSON.stringify(d),day=copy(d),requests=[]
 day.entries=await q.valueEntries(day.entries,date,async(symbol,from)=>{requests.push([symbol,from]);return market(symbol)})
 assert.equal(q.quantityPoint(day).total,907);assert.deepEqual(day.entries.map(e=>e.quantity),[300,2,0,3,4])
 assert.ok(requests.every(([,from])=>from===date));assert.equal(day.entries[1].price.date,date);assert.equal(day.entries[1].fx.value,30)
 const next=b.applyBaseline(d,day,source(d).id,b.baselineRevision(d,source(d).id,date,now),true,now)
 assert.equal(next.version,8);assert.equal(JSON.stringify(d),original);assert.deepEqual(next.accounts,d.accounts);assert.deepEqual(next.history.quantityDays.find(x=>x.date==='2026-10-09'),d.history.quantityDays[0])
 assert.equal(next.history.quantityDays.length,2)
})
test('later accounts and instruments do not contaminate a confirmed complete destination or its charts',async()=>{
 let d=fixture();d=b.applyBaseline(d,copy(d),source(d).id,b.baselineRevision(d,source(d).id,date,now),true,now)
 d.accounts.push({id:'later',name:'合成後增帳戶',kind:'investment',category:'其他',country:'TW',positions:[{id:'later',type:'cash',symbol:'',currency:'TWD',quantity:999,price:1}]})
 d.accounts[0].positions.push({id:'later-stock',type:'holding',symbol:'LATER',currency:'TWD',quantity:99,price:99})
 const days=await q.valueDays(p.expandPeriodDays(d,now),market),day=days.find(x=>x.date===date)
 assert.equal(day.entries.length,5);assert.equal(q.quantityPoint(day).total,907)
 const total=h.totalPoints({...d,history:{...d.history,valuedQuantityDays:days}},now).find(x=>x.date===date)
 assert.equal(total.total,907);assert.equal(total.accounts.length,5)
 const account=d.accounts[1],position=account.positions[0]
 assert.equal(t.positionTimeline(d,account,position,await market('TEST'),await market('USDTWD=X'),now).days.find(x=>x.date===date).value,600)
 const later=d.accounts.at(-1);assert.equal(t.positionTimeline(d,later,later.positions[0],null,null,now).days.find(x=>x.date===date).value,0)
 assert.equal(t.positionTimeline(d,d.accounts[0],d.accounts[0].positions[1],null,null,now).days.find(x=>x.date===date).value,0)
})
test('complete copy is one-day-only and does not alter existing holding-period transitions',async()=>{
 let d=fixture();const e=source(d).entries[0]
 d.history.holdingPeriods=[{...e,id:'period',start:'2026-08-30',end:'2026-09-02',quantity:10,updatedAt:now,timeZone:'UTC'}]
 d=b.applyBaseline(d,copy(d),source(d).id,b.baselineRevision(d,source(d).id,date,now),true,now)
 assert.equal(p.periodQuantityOn(d,e,date).quantity,10);assert.equal(p.periodQuantityOn(d,e,'2026-09-02').quantity,0)
 const expanded=p.expandPeriodDays(d,now);assert.equal(expanded.find(x=>x.date===date).entries[0].quantity,300)
 assert.equal(expanded.find(x=>x.date==='2026-09-02').entries.find(x=>x.accountId==='A').quantity,0)
 const timeline=t.positionTimeline(d,d.accounts[0],d.accounts[0].positions[0],null,null,now).days
 assert.equal(timeline.find(x=>x.date===date).quantity,300);assert.equal(timeline.find(x=>x.date==='2026-09-02').quantity,0)
})
test('missing quantities and snapshot-only sources are blocked; zero and explicitly empty inventories are valid',async()=>{
 const d=fixture();d.history.snapshots=[{date:'2026-08-01',at:now,total:100,accounts:[{id:'unknown',name:'合成未知',value:100}],categories:{其他:100}}]
 assert.equal(b.quantityBaselines(d,now).some(x=>x.date==='2026-08-01'),false)
 d.history.quantityDays[0].entries[1].quantity=null;assert.match(source(d).error,/未知/);assert.throws(()=>copy(d),/未知/)
 const empty={...m.emptyData(),accounts:[{id:'empty',name:'合成空帳戶',kind:'investment',country:'TW',category:'其他',positions:[]}]}
 const baseline=b.quantityBaselines(empty,now)[0],day=b.baselineDay(baseline,date,[],now)
 assert.equal(q.quantityPoint(day).total,0);assert.deepEqual(q.quantityPoint(day).accounts,[{id:'empty',name:'合成空帳戶',value:0}])
 const zero={...fixture()};const src=source(zero);const allZero=b.baselineDay(src,date,src.entries.map(e=>({...e,quantity:0})),now)
 assert.equal(q.quantityPoint({...allZero,entries:await q.valueEntries(allZero.entries,date,()=>assert.fail('zero should not fetch'))}).total,0)
})
test('unknown original snapshot coverage blocks an unverified source and current lots aggregate by currency',()=>{
 const d=fixture();delete d.history.quantityDays[0].inventory;d.history.quantityDays[0].sparse=true;d.history.snapshots=[{date:'2026-10-09',at:now,total:999,accounts:[{id:'missing',name:'合成缺項',value:999}],categories:{其他:999}}]
 assert.match(source(d).error,/未驗證/)
 d.accounts[0].positions.push({...d.accounts[0].positions[0],id:'lot2',quantity:5},{...d.accounts[0].positions[0],id:'usd',currency:'USD',quantity:2})
 const current=b.quantityBaselines(d,now)[0];assert.equal(current.entries.find(e=>e.accountId==='A'&&e.currency==='TWD').quantity,105);assert.equal(current.entries.find(e=>e.accountId==='A'&&e.currency==='USD').quantity,2)
})
test('destination overwrite requires confirmation; stale source, destination and period changes reject apply',()=>{
 const d=fixture(),day=copy(d),id=source(d).id,revision=b.baselineRevision(d,id,date,now)
 assert.throws(()=>b.applyBaseline(d,day,id,revision,false,now),/確認/)
 for(const mutate of [x=>x.history.quantityDays[0].entries[0].quantity++,x=>x.history.quantityDays.push({...day,entries:[]}),x=>x.history.snapshots.push({date,at:now,total:0,accounts:[],categories:{}}),x=>x.history.changes.push({at:now})]){
  const next=structuredClone(d);mutate(next);assert.throws(()=>b.applyBaseline(next,day,id,revision,true,now),/已變更/)
 }
 assert.throws(()=>b.baselineDay(source(d),'2026-10-09',source(d).entries,now),/不同/)
 assert.throws(()=>b.baselineDay(source(d),'2026-10-10',source(d).entries,now),/未來/)
})
test('v8 complete scope survives save/reload, normal edits and async saves while v1–v7 remain compatible',()=>{
 const d=fixture(),day=copy(d),next=b.applyBaseline(d,day,source(d).id,b.baselineRevision(d,source(d).id,date,now),true,now)
 const reloaded=m.parseWealthData(JSON.parse(JSON.stringify(h.recordSave(d,{...next,updatedAt:now}))))
 assert.equal(reloaded.version,8);assert.deepEqual(reloaded.history.quantityDays[0].inventory,day.inventory)
 const edited=q.applyQuantityDay(reloaded,{...reloaded.history.quantityDays[0],entries:reloaded.history.quantityDays[0].entries.map(e=>({...e,quantity:0}))},reloaded.history.quantityDays[0]);assert.equal(edited.version,8);assert.ok(edited.history.quantityDays[0].inventory)
 assert.equal(s.finishSave({...d},d,reloaded).version,8)
 for(const version of [1,2,3,4,5,6,7]) { const legacy=structuredClone(d);delete legacy.history.quantityDays[0].inventory;assert.equal(m.parseWealthData({...legacy,version}).version,version) }
 for(const mutate of [x=>x.sparse=true,x=>x.entries[0].quantity=null,x=>x.inventory.accounts=[],x=>x.inventory.source.date='invalid']){
  const bad=structuredClone(day);mutate(bad);assert.throws(()=>q.parseQuantityDays([bad]),/完整持倉|完整回補/)
 }
})
test('source quotes and split basis never transfer and missing destination markets remain unknown',async()=>{
 const d=fixture();d.history.quantityDays[0].entries[1]={...d.history.quantityDays[0].entries[1],quantityAsOf:'2020-01-01',price:{source:'Yahoo',symbol:'TEST',date:'2026-10-08',value:100},fx:{source:'Yahoo',symbol:'USDTWD=X',date:'2026-10-08',value:40}}
 const day=copy(d);assert.equal(day.entries[1].price,undefined);assert.equal(day.entries[1].quantityAsOf,undefined)
 const entries=await q.valueEntries(day.entries,date,async()=>null)
 assert.equal(q.quantityPoint({...day,entries}).total,null);assert.equal(entries[1].quantity,2)
})

test('review: sparse and legacy unverified sources cannot become complete even without snapshots or with same-account omissions',()=>{
 for(const sparse of [true,undefined]) {
  const d=fixture();delete d.history.quantityDays[0].inventory;d.history.quantityDays[0].sparse=sparse;d.history.quantityDays[0].entries=d.history.quantityDays[0].entries.slice(0,1)
  d.accounts[0].positions.push({id:'missing',type:'cash',symbol:'',currency:'USD',quantity:500000,price:1})
  const src=source(d);assert.match(src.error,/部分或未驗證/);assert.equal(src.verified,false)
  assert.throws(()=>b.baselineDay(src,date,src.entries,now),/不能作完整基底/)
  assert.throws(()=>b.baselineDay({...src,error:''},date,src.entries,now),/未驗證/)
  assert.equal(d.accounts[0].positions[1].quantity,500000);assert.equal(d.history.quantityDays.length,1)
 }
 assert.equal(source(fixture()).error,'');assert.equal(b.quantityBaselines(fixture(),now)[0].error,'')
})


test('explicit date editing updates the complete day with fresh valuation and retains inventory provenance',async()=>{
 const data=fixture(),from=source(data),date=from.date,revision=b.baselineRevision(data,from.id,date,now)
 const entries=from.entries.map(e=>({...e,quantity:e.accountId==='A'?150:e.quantity}))
 const day=b.baselineDay(from,date,entries,now,'edit')
 assert.equal(day.entries[1].price,undefined);assert.equal(day.entries[1].fx,undefined)
 day.entries=await q.valueEntries(day.entries,date,async symbol=>({symbol,currency:symbol==='USDTWD=X'?'TWD':'USD',asTraded:true,splits:[],points:[{date,close:symbol==='USDTWD=X'?30:10}]}))
 const next=b.applyBaseline(data,day,from.id,revision,true,now,'edit')
 assert.deepEqual(next.history.quantityDays[0].inventory,data.history.quantityDays[0].inventory)
 assert.equal(next.history.quantityDays[0].entries[0].quantity,150);assert.equal(next.history.quantityDays[0].entries[1].price.date,date)
 assert.equal(next.history.quantityDays[0].entries[1].fx.value,30);assert.deepEqual(next.accounts,data.accounts)
 assert.throws(()=>b.applyBaseline(next,day,from.id,revision,true,now,'edit'),/已變更/)
 assert.throws(()=>b.baselineDay(from,date,entries.map(e=>({...e,quantity:null})),now,'edit'),/數量/)
})
