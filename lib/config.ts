export const config = {
  demoMode: () => (process.env.DEMO_MODE ?? "true") !== "false",
  solanaMock: () => (process.env.SOLANA_MOCK ?? "true") !== "false",
  // A provider token, when set, goes in the URL path so both HTTP and websocket calls authenticate.
  rpcUrl: () => {
    const base = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
    const token = process.env.SOLANA_RPC_TOKEN?.trim();
    return token ? `${base.replace(/\/+$/, "")}/${token}/` : base;
  },
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
