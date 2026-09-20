export const INPUT_FIELDS = [
  {key:'renterHouseholdsPercent',label:'Renter households',unit:'%',scope:'3_mile',scopeLabel:'3-mile radius',min:0,max:100,query:'renter occupied households 3 mile radius'},
  {key:'violentCrimeRate',label:'Violent crime index',unit:'/ 100',scope:'zip_code',scopeLabel:'ZIP code · BestPlaces scale',min:1,max:100,query:'site:bestplaces.net crime'},
  {key:'propertyCrimeRate',label:'Property crime index',unit:'/ 100',scope:'zip_code',scopeLabel:'ZIP code · BestPlaces scale',min:1,max:100,query:'site:bestplaces.net crime'},
  {key:'schoolRatings',label:'School rating',unit:'/ 10',scope:'assigned_schools',scopeLabel:'Mean of rated assigned public schools',min:1,max:10,query:'assigned schools GreatSchools'},
  {key:'walkScore',label:'Walk Score',unit:'/ 100',scope:'property',scopeLabel:'Property address',min:0,max:100,query:'Walk Score'},
  {key:'transitScore',label:'Transit Score',unit:'/ 100',scope:'property',scopeLabel:'Property address',min:0,max:100,query:'Transit Score'},
];
export function initializeReferenceInputs() {
  return {
    property:null, snapshotId:null,revisionId:null,fields:[], breakdown:{}, loading:true,busy:false,saving:false,error:'',message:'',listing:'',unavailable:[],
    async request(url,body) {
      const response = await fetch(url,body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.'); return data;
    },
    get endpoint(){return `/api/reference-data/properties/${this.property?.id}`;},
    get address(){const a=this.property?.address;return a ? [a.street,a.city,a.stateAbbr].filter(Boolean).join(', ') : '';},
    get listingSearch(){return 'https://www.google.com/search?q='+encodeURIComponent(`site:zillow.com/apartments/ ${this.address}`);},
    searchLink(field){const a=this.property?.address; const location=field.scope==='zip_code' ? [a?.zipCode,a?.city,a?.stateAbbr].filter(Boolean).join(' ') : this.address;return 'https://www.google.com/search?q='+encodeURIComponent(`${location} ${field.query}`);},
    sourceLink(value){try {const u=new URL(value);return ['http:','https:'].includes(u.protocol) ? u.href : null;} catch{return null;}},
    get savedCount(){return this.fields.filter(f=>f.value!=='' && f.value!=null).length;},
    get remainingCount(){return Object.values(this.breakdown).filter(f=>f.rawValue==null && f.weight>0).length;},
    async init(){await this.load();},
    async load(){
      this.loading=true;this.error='';
      try {
        const id=new URLSearchParams(window.location.search).get('property');
        if(!/^\d+$/.test(id||'')) throw new Error('Open a property from the dashboard to complete its inputs.');
        const data=await this.request(`/api/reference-data/properties/${id}`);
        this.property=data.property;this.snapshotId=data.snapshotId;this.revisionId=data.revisionId;this.breakdown=data.breakdown;
        this.fields=INPUT_FIELDS.map(f=>({...f,value:'',sourceUrl:'',observedAt:new Date().toISOString().slice(0,10),notes:'',method:'manual',...(data.observations[f.key] || {})}));
        for (const field of this.fields) field.observedAt=field.observedAt.slice(0,10);
        this.listing=this.fields.find(f=>f.method==='public_listing')?.sourceUrl || '';
      } catch(e){this.error=e.message;} finally{this.loading=false;}
    },
    async readListing(){
      if(this.busy||this.saving)return;
      this.busy=true;this.error='';this.message='';this.unavailable=[];
      try {
        const data=await this.request(`${this.endpoint}/read-listing`,{url:this.listing});
        for(const field of this.fields){const found=data.observations[field.key];if(found) Object.assign(field,found,{observedAt:found.observedAt.slice(0,10)});}
        this.unavailable=data.unavailable;
        if (data.matchedAddress.zipCode) this.property.address.zipCode=data.matchedAddress.zipCode;
        this.message=`Found ${Object.keys(data.observations).length} inputs. Review and save below.`;
      } catch(e){this.error=e.message;} finally{this.busy=false;}
    },
    async save(){
      if(this.saving||this.busy)return;this.saving=true;this.error='';this.message='';
      try {
        const observations=Object.fromEntries(this.fields.map(f=>[f.key,f.value===''||f.value==null ? null : {value:Number(f.value),sourceUrl:f.sourceUrl,observedAt:f.observedAt,scope:f.scope,notes:f.notes,method:f.method,sourceHash:f.sourceHash}]));
        await this.request(this.endpoint,{observations,snapshotId:this.snapshotId,revisionId:this.revisionId});
        await this.load(); this.message=this.error ? '' : 'Inputs saved. Assessment recalculated.';
      }catch(e){this.error=e.message;}finally{this.saving=false;}
    },
  };
}
