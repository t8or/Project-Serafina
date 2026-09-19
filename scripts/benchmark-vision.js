/** Compare generative OCR on the image-only test page. Never promotes model output to facts. */
import fs from 'node:fs/promises';
const [model,imagePath]=process.argv.slice(2);if(!model||!imagePath)throw Error('Supply model tag and scanned fixture page PNG');
const started=performance.now();
const response=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(180000),body:JSON.stringify({
 model,stream:false,think:false,keep_alive:0,format:{type:'object',properties:{income3mile:{type:'number'},solarKw:{type:'number'}},required:['income3mile','solarKw']},
 options:{temperature:0,num_ctx:8192,num_predict:500},messages:[{role:'user',content:'Read the image. Return the median household income in the 3 Mile column and the stated solar capacity in kW. The columns may not be in ascending order. Do not guess.',images:[(await fs.readFile(imagePath)).toString('base64')]}]
})});
const raw=await response.json();if(!response.ok)throw Error(JSON.stringify(raw));let parsed;try{parsed=JSON.parse(raw.message.content)}catch{}
const result={model,seconds:(performance.now()-started)/1000,correct:parsed?.income3mile===83210&&parsed?.solarKw===317,parsed,doneReason:raw.done_reason,loadSeconds:raw.load_duration/1e9,promptSeconds:raw.prompt_eval_duration/1e9,generationSeconds:raw.eval_duration/1e9};
await fs.writeFile('/tmp/serafina-vision-benchmark-'+model.replace(/[^a-z0-9.-]/gi,'_')+'.json',JSON.stringify(result,null,2));console.log(result);
