"""Prepare a real speech spectrum and native ONNX reference for browser comparison."""
from pathlib import Path
import shutil
import sys
import numpy as np
import soundfile as sf
import torch
import onnxruntime as ort

root = Path(__file__).resolve().parent
public = root / 'public'
public.mkdir(exist_ok=True)
model = root.parents[1] / 'apps/desktop/vendor/separator-models/UVR-MDX-NET-Inst_HQ_3.onnx'
shutil.copyfile(model, public / 'model.onnx')
audio, rate = sf.read(sys.argv[1], always_2d=True)
assert rate == 44100
audio = np.resize(audio.T, (2, 1024*255)).astype('float32')
audio.astype('<f4').tofile(public / 'chunk.bin')
spec = torch.stft(torch.from_numpy(audio), n_fft=6144, hop_length=1024,
                  window=torch.hann_window(6144), return_complex=True)
data = torch.view_as_real(spec).permute(0,3,1,2).reshape(1,4,3073,256)[:,:,:3072,:].numpy().copy()
data[:,:,:3,:] = 0
session = ort.InferenceSession(str(model), providers=['CPUExecutionProvider'])
expected = session.run(None, {'input': data})[0]
data.astype('<f4').tofile(public / 'input.bin')
expected.astype('<f4').tofile(public / 'expected.bin')
complex_output = torch.from_numpy(expected.reshape(2,2,3072,256))
complex_output = torch.complex(complex_output[:,0], complex_output[:,1])
complex_output = torch.nn.functional.pad(complex_output, (0,0,0,1))
wave = torch.istft(complex_output, n_fft=6144, hop_length=1024, window=torch.hann_window(6144))
wave.numpy().astype('<f4').tofile(public / 'wave-reference.bin')
print({'shape':data.shape,'referenceRMS':float(np.sqrt(np.mean(expected**2)))})
