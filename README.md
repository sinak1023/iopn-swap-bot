# OPN Farming Bot


## Overview

The **OPN Farming Bot** is an open-source, automated trading script designed for the OPN Testnet (Chain ID: 984). Built with Node.js and the ethers.js library, it performs forward and reverse swaps between the native OPN token and selected ERC-20 tokens (OPNT, TUSDT, tBNB) via a decentralized exchange router. This bot is intended for educational and testing purposes on the testnet, simulating farming strategies by cycling small portions of OPN through token swaps to potentially earn rewards or test liquidity.

**Key Features:**
- **Randomized Swaps**: Forward swaps use 0.5%-1.5% of OPN balance (randomized around 1%); reverse swaps use 5%-15% of token balances (randomized around 10%).
- **Liquidity Checks & Retries**: Pre-swap checks for expected output amounts to avoid reverts; automatic retry with adjusted slippage (95% initial, 50% on retry) for failed transactions.
- **Sequential Execution**: Forwards and reverses run sequentially with random delays (5-30 seconds between actions) to prevent nonce conflicts and mimic organic trading.
- **24-Hour Cycles**: After completing swaps for all wallets, the bot rests for 24 hours before repeating the cycle (configurable for testing).
- **Multi-Wallet & Proxy Support**: Handles multiple private keys and rotating proxies for distributed operation.
- **Slippage & Gas Management**: Configurable slippage (default 95%), dynamic gas pricing (10-15 gwei), and gas limits (300k) for efficient testnet transactions.
- **Logging & Monitoring**: Colorful console logs for success, errors, warnings, and transaction details (including Etherscan-like explorer links).

This bot is **testnet-only** and not intended for mainnet or real funds. Use it to learn about DeFi interactions, smart contract calls, and automated trading logic.

For support, updates, or discussions, join the Telegram channel: [@ostadkachal](https://t.me/ostadkachal).

## Disclaimer

- **Educational Use Only**: This bot is for learning and testnet experimentation. It does not guarantee profits and may result in failed transactions due to network conditions, liquidity, or slippage.
- **No Financial Advice**: Cryptocurrency trading involves risks, including loss of testnet funds. Always test thoroughly and never use real assets without understanding the code.
- **Testnet Specific**: Configured for OPN Testnet RPC. Mainnet deployment requires modifications and is at your own risk.
- **Open Source**: Contributions welcome via pull requests. Review the code before use.

## Requirements

- **Node.js**: v18+ (ethers.js v6 compatible).
- **Dependencies**: Listed in `package.json` (ethers, fs, readline-sync, https-proxy-agent, chalk, dotenv).
- **Files Needed**:
  - `private_keys.txt`: One private key per line (no 0x prefix; testnet keys only).
  - `proxies.txt`: One proxy per line (format: `ip:port:username:password`; optional).
  - `.env`: RPC_URL (default: `https://testnet-rpc.iopn.tech/`).
- **Testnet Funds**: Ensure wallets have OPN for gas and swaps (faucet via OPN docs).

## Installation

1. **Clone the Repository**:
   ```
   git clone https://github.com/sinak1023/iopn-swap-bot.git
   cd iopn-swap-bot
   ```

2. **Install Dependencies**:
   ```
   npm install
   ```

3. **Prepare Files**:
   - Create `private_keys.txt` with your testnet private keys (e.g., one wallet for testing).
   - (Optional) Add proxies to `proxies.txt`.
   - (Optional) Set `RPC_URL` in `.env` if using a custom provider.

4. **Verify Setup**:
   - Run `node bot.js` – it will prompt for the number of forward swaps (default: 3).

## Configuration

Edit constants in `bot.js` for customization:

- **Swap Pairs**: `SWAP_PAIRS` array – Add/remove tokens (e.g., include WOPN for wrapped OPN handling).
- **Amounts & Tolerance**:
  - `FORWARD_PERCENT_BASE = 0.01` (1% base for forwards).
  - `FORWARD_TOLERANCE = 0.005` (±0.5%).
  - `REVERSE_PERCENT_BASE = 0.10` (10% base for reverses).
  - `REVERSE_TOLERANCE = 0.05` (±5%).
- **Slippage & Gas**:
  - `SLIPPAGE = 950n` (95%; lower to 800n for volatile pairs).
  - `GAS_LIMIT = 300000`.
  - `MAX_GAS_PRICE = ethers.parseUnits('15', 'gwei')`.
- **Cycle Timing**:
  - `CYCLE_REST_MS = 86400000` (24 hours; set to 30000 for 30s testing).
  - Delays: 5-30s between swaps, 10-60s between wallets.
- **Liquidity Threshold**:
  - `MIN_LIQUIDITY_OUT = 1000000000000n` (~0.000001 token; lower to allow micro-swaps).
- **ABI & Contracts**:
  - `ROUTER_ABI`, `TOKEN_ABI`: Minimal interfaces for router and tokens (expand from `paste.txt` if needed).
  - Addresses: OPN Testnet-specific (WOPN, OPNT, TUSDT, tBNB, Router).

For advanced tweaks (e.g., custom paths or WOPN unwrap), modify `performForwardSwap` and `performReverseSwap` functions.

## Usage

1. **Start the Bot**:
   ```
   node bot.js
   ```
   - Clears console and shows banner.
   - Loads wallets/proxies.
   - For the first run: Prompts "Forward swaps? (1-50, def 3):" – Enter a number (e.g., 3).
   - Subsequent 24h cycles repeat the same number without prompting.

2. **What Happens**:
   - **Wallet Initialization**: Fetches balances for OPN and tokens.
   - **Forward Phase**: Performs N random swaps (OPN → random token, e.g., 0.8% of balance).
     - Checks liquidity via `getAmountsOut`.
     - Encodes calldata for router (ABI-packed for `swapExactETHForTokens`).
     - Broadcasts TX; retries on revert.
   - **Reverse Phase**: For each swapped token, reverses 10% ±5% back to OPN (sequential to avoid nonce issues).
     - Skips approve if allowance sufficient.
     - Handles WOPN unwrap specially.
   - **Cycle End**: Logs final OPN balance; rests 24h; repeats.

3. **Sample Output**:
   ```
   ✅ Bot ready: 1 wallets
   Wallet 1/1: 0xE1e879Db... (OPN: 1.842053)
   Running 3 forward swaps...
   Forward 1/3: OPN → OPNT
   Random amount: 0.014299 OPN (0.8% of balance)
   Expected out: 0.244 OPNT
   ✅ Forward TX: 0xabc... | View: https://testnet.iopn.tech/tx/0xabc...
   ✅ Forward success | Gas used: 150000 | Block: 456xxxx
   Waiting 15s before next forward...
   ...
   Forwards done: 3/3
   Starting reverses...
   Reverse: OPNT → OPN
   Random amount: 0.024 OPNT (11% of balance)
   ✅ Reverse success | Gas used: 150000
   Reverses done: 2/3
   Final OPN: 1.850
   Cycle complete! Resting 24h before repeat (3 swaps)...
   ```

4. **Stopping the Bot**:
   - Press `Ctrl+C` – Graceful shutdown.
   - Handles uncaught errors/rejections.

5. **Monitoring**:
   - View TXs: Links to `https://testnet.iopn.tech/tx/[hash]`.
   - Debug: Increase logs in `performForwardSwap` for `amountsOut` details.
   - Telegram: Share logs/errors in [@ostadkachal](https://t.me/ostadkachal) for help.

## Troubleshooting

- **Nonce Errors**: Sequential execution prevents this; if seen, check proxy/RPC stability.
- **Reverts (Slippage/Liquidity)**: Lower `SLIPPAGE` or `MIN_LIQUIDITY_OUT`; ensure testnet faucet for gas.
- **Proxy Fails**: Bot falls back to direct RPC; verify proxy format.
- **Low Balances**: Bot skips if OPN <0.002; top up via faucet.
- **Zero Liquidity**: Skip occurs only if `getAmountsOut` returns 0; test pairs manually on explorer.
- **Dependencies Issues**: Run `npm install` again; ensure ethers v6.

If issues persist, open a GitHub issue or message [@ostadkachal](https://t.me/ostadkachal).

## Development & Contributions

- **Tech Stack**: Node.js, ethers.js (v6), chalk for logging.
- **Extending**:
  - Add strategies: Modify `nextForward` for custom logic (e.g., RSI indicators via external libs).
  - Backtesting: Integrate historical data fetches (not included; use ethers for simulations).
  - Mainnet: Update RPC/CHAIN_ID; add real risk controls (e.g., max loss).
- **Contribute**:
  1. Fork the repo.
  2. Create a feature branch (`git checkout -b feature/amazing-feature`).
  3. Commit changes (`git commit -m 'Add amazing feature'`).
  4. Push (`git push origin feature/amazing-feature`).
  5. Open a Pull Request.

## License

MIT License – See [LICENSE](LICENSE) for details. Free to use, modify, and distribute.

## Acknowledgments

- Built on ethers.js for Ethereum interactions.
- Inspired by open-source trading bots like Freqtrade and Jesse.
- Special thanks to the OPN Testnet team for the ecosystem.
- Support community: [@ostadkachal](https://t.me/ostadkachal) on Telegram.

