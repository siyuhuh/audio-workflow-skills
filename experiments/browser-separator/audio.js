import FFT from 'fft.js';
const N=6144, H=1024, T=256, F=3072, L=H*(T-1), G=L-N;
const fft=new FFT(2048);
const window=Float64Array.from({length:N},(_,i)=>0.5-0.5*Math.cos(2*Math.PI*i/N));
// Mixed-radix 3 x 2048 FFT, matching this model's non-power-of-two STFT.
function transform(real, imag, inverse=false) {
  const parts=[];
  for(let r=0;r<3;r++) {
    const input=new Float64Array(4096), output=new Float64Array(4096);
    for(let j=0;j<2048;j++){input[2*j]=real[3*j+r];input[2*j+1]=(imag?.[3*j+r]??0)*(inverse?-1:1);}
    fft.transform(output,input); parts.push(output);
  }
  const outR=new Float64Array(N),outI=new Float64Array(N);
  for(let k=0;k<N;k++) for(let r=0;r<3;r++) {
    const a=-2*Math.PI*r*k/N,c=Math.cos(a),s=Math.sin(a),q=2*(k%2048);
    outR[k]+=(parts[r][q]*c-parts[r][q+1]*s)/(inverse?N:1);
    outI[k]+=(parts[r][q]*s+parts[r][q+1]*c)*(inverse?-1/N:1);
  }
  return [outR,outI];
}
export function spectrum(channels) {
  const data=new Float32Array(4*F*T);
  for(let ch=0;ch<2;ch++)for(let t=0;t<T;t++) {
    const frame=new Float64Array(N);
    for(let n=0;n<N;n++) {
      let i=t*H+n-N/2;
      if(i<0)i=-i;if(i>=L)i=2*L-2-i;
      frame[n]=channels[ch][i]*window[n];
    }
    const [real,imag]=transform(frame);
    for(let f=0;f<F;f++){data[((ch*2)*F+f)*T+t]=real[f];data[((ch*2+1)*F+f)*T+t]=imag[f];}
  }
  return data;
}
export function inverseSpectrum(data) {
  const channels=[];
  for(let ch=0;ch<2;ch++) {
    const out=new Float64Array(L+N),weight=new Float64Array(L+N);
    for(let t=0;t<T;t++) {
      const real=new Float64Array(N),imag=new Float64Array(N);
      for(let f=0;f<F;f++) {
        real[f]=data[((ch*2)*F+f)*T+t];imag[f]=data[((ch*2+1)*F+f)*T+t];
        if(f>0){real[N-f]=real[f];imag[N-f]=-imag[f];}
      }
      const [frame]=transform(real,imag,true);
      for(let n=0;n<N;n++){out[t*H+n]+=frame[n]*window[n];weight[t*H+n]+=window[n]**2;}
    }
    channels.push(Float32Array.from({length:L},(_,i)=>out[i+N/2]/weight[i+N/2]));
  }
  return channels;
}
export async function separate(buffer,session,ort,report) {
  const count=Math.min(buffer.length,44100*30), primary=[new Float32Array(count),new Float32Array(count)];
  const source=[buffer.getChannelData(0),buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1))];
  let peak=0;for(const channel of source)for(let i=0;i<count;i++)peak=Math.max(peak,Math.abs(channel[i]));
  peak=peak||1;
  for(let start=0;start<count;start+=G) {
    const chunk=source.map(channel=>Float32Array.from({length:L},(_,i)=>(channel[start+i-N/2]??0)/peak));
    const data=spectrum(chunk);
    for(let ch=0;ch<4;ch++)data.fill(0,ch*F*T,ch*F*T+3*T);
    const tensor=new ort.Tensor('float32',data,[1,4,F,T]);
    const outputs=await session.run({input:tensor}),result=outputs[session.outputNames[0]];
    const wave=inverseSpectrum(await result.getData());
    for(let ch=0;ch<2;ch++)for(let i=0;i<G&&start+i<count;i++)primary[ch][start+i]=wave[ch][i+N/2]*peak*1.022;
    result.dispose();tensor.dispose();report({processedSeconds:Math.min(start+G,count)/44100});
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  const vocals=primary.map((channel,ch)=>Float32Array.from(channel,(v,i)=>source[ch][i]-v));
  return {primary,vocals,count};
}
export function wav(channels) {
  const length=channels[0].length, bytes=new ArrayBuffer(44+length*4),view=new DataView(bytes);
  const str=(offset,s)=>[...s].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
  str(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,44100,true);view.setUint32(28,176400,true);view.setUint16(32,4,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,length*4,true);
  for(let i=0;i<length;i++)for(let ch=0;ch<2;ch++){if(!Number.isFinite(channels[ch][i]))throw Error('Nonfinite PCM');view.setInt16(44+i*4+ch*2,Math.max(-1,Math.min(1,channels[ch][i]))*32767,true);}
  return new Blob([bytes],{type:'audio/wav'});
}
