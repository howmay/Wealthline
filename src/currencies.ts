// Keep currency entry/import and the rate provider on the same crypto allowlist.
// Three-letter codes remain accepted for existing/manual fiat-rate workflows.
export const CRYPTO_IDS: Record<string, string> = {
  USDT: 'tether',
  USDC: 'usd-coin',
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
}
export const isSupportedCurrency = (currency: string) => /^[A-Z]{3}$/.test(currency) || Object.hasOwn(CRYPTO_IDS, currency)
