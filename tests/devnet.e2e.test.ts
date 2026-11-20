import { describe, expect, it } from "vitest";

const enabled = process.env.SOLANA_E2E === "1";
const suite = enabled ? describe : describe.skip;

suite("devnet escrow round trip", () => {
  it("funds and releases against real devnet", async () => {
    process.env.SOLANA_MOCK = "false";
    const { DevnetSolana, ESCROW_PUBKEY } = await import("@/lib/solana");
    const service = new DevnetSolana();
    const wallet = service.createWallet();
    const minted = await service.airdropTokens(wallet.pubkey, 5_000_000n);
    expect(minted.length).toBeGreaterThan(20);

    const seller = service.createWallet();
    const escrowBefore = await service.balance(wallet.pubkey);
    const signature = await service.transfer({
      fromSecretEnc: wallet.secretEnc,
      fromPubkey: wallet.pubkey,
      toPubkey: ESCROW_PUBKEY(),
      baseUnits: 1_000_000n,
    });
    expect(signature.length).toBeGreaterThan(20);
    expect(await service.balance(wallet.pubkey)).toBe(escrowBefore - 1_000_000n);

    await service.transferFromEscrow({ toPubkey: seller.pubkey, baseUnits: 900_000n });
    expect(await service.balance(seller.pubkey)).toBe(900_000n);

    const memo = await service.memo("order-fixture", "released");
    expect(memo.length).toBeGreaterThan(20);
  });
});
