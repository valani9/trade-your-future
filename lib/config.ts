export const config = {
  demoMode: () => (process.env.DEMO_MODE ?? "true") !== "false",
  solanaMock: () => (process.env.SOLANA_MOCK ?? "true") !== "false",
  rpcUrl: () => process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  mint: () => process.env.MINT_ADDRESS ?? "",
  escrowSecret: () => process.env.ESCROW_SECRET ?? "",
  walletKey: () => process.env.WALLET_ENC_KEY ?? "",
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string, public code = "error") {
    super(message);
    this.status = status;
  }
}
