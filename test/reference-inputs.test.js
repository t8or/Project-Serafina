import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'serafina-reference-'));
process.env.SERAFINA_DATA_DIR=root;
const {initDb,db}=await import('../src/config/database.js');
const {parseListing,listingUrl,readPublicListing}=await import('../src/services/public_listing.js');
const {validateObservations,applyObservations,loadPropertyAssessment,saveReferenceInputs,recalculateProperty}=await import('../src/services/assessment_reference.js');
const {PropertyService}=await import('../src/services/property_service.js');
await initDb();after(async()=>{db.close();await fs.rm(root,{recursive:true,force:true});});
const address={street:'123 Main St',city:'Phoenix',stateAbbr:'AZ'};
const url='https://www.zillow.com/apartments/phoenix-az/example/abc/';
const building={streetAddress:'123 Main Street',city:'Phoenix',state:'AZ',walkScore:{walkscore:0},assignedSchools:[{schoolId:1,name:'Elementary',rating:5,isAssigned:true,type:'PUBLIC'},{schoolId:1,name:'Elementary',rating:5,isAssigned:true,type:'PUBLIC'},{schoolId:2,name:'High',rating:7,isAssigned:true,type:'PUBLIC'},{schoolId:3,name:'Nearby private',rating:10,isAssigned:false,type:'PRIVATE'},{schoolId:4,name:'Unrated',rating:null,isAssigned:true,type:'PUBLIC'}]};
const html=b=>`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{componentProps:{initialReduxState:{gdp:{building:b}}}}}})}</script>`;
const obs={value:52,sourceUrl:url,observedAt:new Date().toISOString(),scope:'property',notes:'Published score'};
test('listing reader uses the exact building, preserves zero, excludes unrated and duplicate schools, and does not invent transit',()=>{
 const r=parseListing(html(building),address,url);
 assert.equal(r.observations.walkScore.value,0);assert.equal(r.observations.schoolRatings.value,6);assert.deepEqual(r.unavailable,['transitScore']);
 assert.throws(()=>parseListing(html({...building,streetAddress:'124 Main St'}),address,url),/does not match/);
 assert.throws(()=>parseListing(html({...building,city:'Tucson'}),address,url),/does not match/);
 assert.throws(()=>parseListing('<h1>Please log in</h1>',address,url),/did not provide/);
});
test('public lookup rejects arbitrary hosts, credentials, ports, redirects, and oversize pages',async()=>{
 for(const bad of ['http://www.zillow.com/apartments/a/b/c/','https://www.zillow.com.evil.test/apartments/a/b/c/','https://localhost/apartments/a/b/c/','https://a@www.zillow.com/apartments/a/b/c/','https://www.zillow.com:9999/apartments/a/b/c/'])assert.throws(()=>listingUrl(bad));
 await assert.rejects(()=>readPublicListing(url,address,async()=>new Response('',{status:302})),/HTTP 302/);
 await assert.rejects(()=>readPublicListing(url,address,async()=>new Response('x'.repeat(4_000_001),{headers:{'content-type':'text/html'}})),/too large/);
});
test('validation enforces units, source links, observation dates and ZIP crime geography',()=>{
 assert.throws(()=>validateObservations({walkScore:{...obs,value:''}}),/between/);
 assert.throws(()=>validateObservations({walkScore:{...obs,sourceUrl:'javascript:alert(1)'}}),/public/);
 assert.throws(()=>validateObservations({renterHouseholdsPercent:{...obs,value:38,scope:'city'}}),/3_mile/);
 assert.throws(()=>validateObservations({violentCrimeRate:{...obs,value:45,scope:'zip_code',sourceUrl:'https://www.bestplaces.net/crime/city/arizona/phoenix'}}),/ZIP-code/);
 const r=validateObservations({renterHouseholdsPercent:{...obs,value:38,scope:'3_mile'}});
 assert.equal(applyObservations({},r).demographics.renter_households_pct_3mile,.38);
 assert.equal(applyObservations({walkScore:{walk_score:52}}, {walkScore:null}).walkScore.walk_score,undefined);
});
test('save publishes source snapshot and score together, survives rescore, and rejects stale edits',async()=>{
 const p=await new PropertyService().createProperty({name:'Example',address});
 // createProperty accepts address fields through its address argument.
 const ctx=await loadPropertyAssessment(p.id);
 assert.equal(ctx.address.street,address.street);
 const saved=await saveReferenceInputs(p.id,{walkScore:obs},null,null);
 await assert.rejects(()=>new PropertyService().saveScore(p.id,saved.score,ctx.projection),/Reference inputs changed/);
 assert.ok(saved.snapshotId);assert.equal(saved.score.breakdown.walkScore.rawValue,52);assert.equal(saved.score.score,null);
 const refreshed=await recalculateProperty(p.id);assert.equal(refreshed.breakdown.walkScore.rawValue,52);
 await assert.rejects(()=>saveReferenceInputs(p.id,{walkScore:{...obs,value:53}},null,null),/changed/);
 assert.equal((await db.query('SELECT * FROM reference_snapshots')).rows.length,1);
 const removed=await saveReferenceInputs(p.id,{walkScore:null},saved.snapshotId,null);assert.equal(removed.score.breakdown.walkScore.rawValue,null);
});
