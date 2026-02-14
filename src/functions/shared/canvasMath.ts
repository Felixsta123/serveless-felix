export const chunkIdFor = (x: number, y: number, chunkSize: number): string => {
  const chunkX = Math.floor(x / chunkSize);
  const chunkY = Math.floor(y / chunkSize);
  return `${chunkX}_${chunkY}`;
};

export const toChunkRange = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  chunkSize: number,
): Array<{ chunkX: number; chunkY: number; chunkId: string }> => {
  const startChunkX = Math.floor(minX / chunkSize);
  const startChunkY = Math.floor(minY / chunkSize);
  const endChunkX = Math.floor(maxX / chunkSize);
  const endChunkY = Math.floor(maxY / chunkSize);

  const chunks: Array<{ chunkX: number; chunkY: number; chunkId: string }> = [];
  for (let chunkX = startChunkX; chunkX <= endChunkX; chunkX++) {
    for (let chunkY = startChunkY; chunkY <= endChunkY; chunkY++) {
      chunks.push({ chunkX, chunkY, chunkId: `${chunkX}_${chunkY}` });
    }
  }
  return chunks;
};
