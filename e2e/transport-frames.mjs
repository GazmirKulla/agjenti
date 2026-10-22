// Docker non-TTY exec multiplexes stdout/stderr into 8-byte length-prefixed frames.
export function dockerFrames(stdout) {
  let pending = Buffer.alloc(0);
  return chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 8) {
      const stream = pending[0], size = pending.readUInt32BE(4);
      if (![1, 2].includes(stream) || size > 16 * 1024 * 1024) throw new Error('Invalid Docker frame');
      if (pending.length < 8 + size) return;
      if (stream === 1) stdout(pending.subarray(8, 8 + size));
      pending = pending.subarray(8 + size);
    }
  };
}
