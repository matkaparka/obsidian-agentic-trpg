// WAV 头处理。DashScope 的 qwen3-tts-flash 返回的 wav 头里「数据长度」是流式占位值（0x7fffff9b），
// 浏览器的 <audio> 对这种文件的总时长判断不可靠，所以落盘前按实际字节数改回正确的长度。

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bits: number;
  /** 数据区从第几个字节开始 */
  dataOffset: number;
  /** 数据区实际字节数（头里的长度比文件还大时取文件实际剩下的） */
  dataBytes: number;
  durationMs: number;
}

export function parseWav(buf: Buffer): WavInfo | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 24 <= buf.length) {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      const dataOffset = offset + 8;
      const dataBytes = Math.max(0, Math.min(size, buf.length - dataOffset));
      if (!sampleRate || !channels || !bits) return null;
      const bytesPerSec = sampleRate * channels * (bits / 8);
      return { sampleRate, channels, bits, dataOffset, dataBytes, durationMs: Math.round((dataBytes / bytesPerSec) * 1000) };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** 把 RIFF 长度和 data 长度改成文件的实际大小；不是 wav 就原样返回。 */
export function fixWavHeader(buf: Buffer): Buffer {
  const info = parseWav(buf);
  if (!info) return buf;
  const out = Buffer.from(buf.subarray(0, info.dataOffset + info.dataBytes));
  out.writeUInt32LE(out.length - 8, 4);
  out.writeUInt32LE(info.dataBytes, info.dataOffset - 4);
  return out;
}
