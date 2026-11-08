import * as ort from 'onnxruntime-web/webgpu';
import {separate,wav} from './audio.js';
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
const log = document.querySelector('#log');
async function run(provider) {
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  log.textContent = '';
  const report = value => { log.textContent += JSON.stringify(value) + '\n'; };
  let session;
  try {
    report({provider, userAgent: navigator.userAgent, gpuAvailable: !!navigator.gpu});
    const start = performance.now();
    session = await ort.InferenceSession.create('/model.onnx', {executionProviders: [provider]});
    report({loadSeconds: (performance.now()-start)/1000});
    const data = new Float32Array(await (await fetch('/input.bin')).arrayBuffer());
    const expected = new Float32Array(await (await fetch('/expected.bin')).arrayBuffer());
    const input = new ort.Tensor('float32', data, [1,4,3072,256]);
    const times = [];
    for (let i=0;i<6;i++) {
      const t = performance.now();
      const result = await session.run({input});
      const output = result[session.outputNames[0]];
      const values = await output.getData();
      let error=0, energy=0, finite=true;
      for(let j=0;j<values.length;j++) {finite &&= Number.isFinite(values[j]); error+=(values[j]-expected[j])**2; energy+=expected[j]**2;}
      times.push((performance.now()-t)/1000);
      report({pass:i+1, seconds:times.at(-1), finite, relativeRMSE:Math.sqrt(error/Math.max(energy,1e-20))});
      output.dispose();
      if (!finite) throw new Error('Nonfinite output');
    }
    input.dispose();
    report({status:'PASS', times, note:'Repeated real-audio spectral chunk, not full 30-second end-to-end separation.'});
  } catch(error) { report({status:'FAIL',error:String(error),stack:error.stack}); }
  finally { await session?.release(); document.querySelectorAll('button').forEach(b=>b.disabled=false); }
}
document.querySelector('#gpu').onclick=()=>run('webgpu');
document.querySelector('#cpu').onclick=()=>run('wasm');
const picker=document.createElement('input');picker.type='file';picker.accept='audio/*';picker.setAttribute('aria-label','选择本地音频，仅处理前 30 秒');document.body.append(picker);
const button=document.createElement('button');button.textContent='分离前 30 秒（未选文件则用测试语音）';document.body.append(button);
button.onclick=async()=>{
  button.disabled=true;log.textContent='';let session;
  const report=v=>log.textContent+=JSON.stringify(v)+'\n';
  try {
    const start=performance.now();
    const context=new OfflineAudioContext(2,44100*30,44100);
    const bytes=picker.files[0]?await picker.files[0].arrayBuffer():await(await fetch('/fixture.wav')).arrayBuffer();
    const buffer=await context.decodeAudioData(bytes);
    session=await ort.InferenceSession.create('/model.onnx',{executionProviders:['webgpu']});
    const ready=performance.now();
    const result=await separate(buffer,session,ort,report);
    for(const [name,channels] of [['伴奏',result.primary],['人声',result.vocals]]){
      const url=URL.createObjectURL(wav(channels)),audio=document.createElement('audio'),link=document.createElement('a');
      audio.controls=true;audio.src=url;link.href=url;link.download=name+'.wav';link.textContent='下载'+name;document.body.append(link,audio);
    }
    report({status:'AUDIO_PASS',duration:result.count/44100,processingSeconds:(performance.now()-ready)/1000,totalSeconds:(performance.now()-start)/1000,note:'Prototype chunk trimming; quality not yet assessed on music.'});
  }catch(e){report({status:'FAIL',error:String(e),stack:e.stack});}
  finally{await session?.release();button.disabled=false;}
};
