// Identifier generation. Random ids in production, sequential ids in tests.
export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function sequentialIds(prefix = 'id') {
  let n = 0;
  return (p = prefix) => `${p}_${String(++n).padStart(6, '0')}`;
}