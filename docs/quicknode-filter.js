// QuickNode Streams filter (Solana devnet, dataset: block).
// Keeps only transactions that carry a Trade Your Future memo and returns a
// compact payload for POST /api/streams/quicknode.
function main(stream) {
  const blocks = Array.isArray(stream.data) ? stream.data : [stream.data];
  const matched = [];
  for (const block of blocks) {
    if (!block || !Array.isArray(block.transactions)) continue;
    for (const tx of block.transactions) {
      const logs = (tx.meta && tx.meta.logMessages) || [];
      const memo = logs.find((line) => line.indexOf("tyf:") !== -1);
      if (!memo) continue;
      matched.push({
        signature: tx.transaction.signatures[0],
        slot: block.parentSlot + 1,
        blockTime: block.blockTime,
        memo: memo,
      });
    }
  }
  return matched.length ? { matchedTransactions: matched } : null;
}
