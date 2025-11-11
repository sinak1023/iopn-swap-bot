var ethers = require('ethers');
var fs = require('fs');
var readlineSync = require('readline-sync');
var HttpsProxyAgent = require('https-proxy-agent');
var chalk = require('chalk');
require('dotenv').config();

var RPC_URL = process.env.RPC_URL || 'https://testnet-rpc.iopn.tech/';
var SWAP_CONTRACT = '0xB489bce5c9c9364da2D1D1Bc5CE4274F63141885';  // Router
var WOPN = '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84';  // Wrapped OPN
var OPNT = '0x2aEc1Db9197Ff284011A6A1d0752AD03F5782B0d';
var TUSDT = '0x3e01b4d892e0d0a219ef8bbe7e260a6bc8d9b31b';
var TBNB = '0x92cf36713a5622351c9489d5556b90b321873607';

var SWAP_PAIRS = [
  { output: OPNT, symbol: 'OPNT', decimals: 18 },
  { output: TUSDT, symbol: 'TUSDT', decimals: 18 },
  { output: TBNB, symbol: 'tBNB', decimals: 18 }
  // WOPN optional: if needed, add { output: WOPN, symbol: 'WOPN', decimals: 18 }
];

var GAS_LIMIT = 300000;  // Increased for safety
var BASE_GAS_PRICE = ethers.parseUnits('11', 'gwei');
var MIN_GAS_PRICE = ethers.parseUnits('10', 'gwei');
var MAX_GAS_PRICE = ethers.parseUnits('15', 'gwei');
var CHAIN_ID = 984;
var SLIPPAGE = 950n;  // 95% original
var DEADLINE_MINUTES = 20;
var CYCLE_REST_MS = 86400000;  // 24h; test: 30000 for 30s
var FORWARD_PERCENT_BASE = 0.01;  // 1%
var FORWARD_TOLERANCE = 0.005;  // ±0.5%
var REVERSE_PERCENT_BASE = 0.10;  // 10%
var REVERSE_TOLERANCE = 0.05;  // ±5%
var MIN_LIQUIDITY_OUT = 1000000000000n;  // 1e12 ~0.000001 token (low to allow small swaps)

// Expanded ABI for router/tokens (from paste.txt)
var ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)'
];
var TOKEN_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',  // For check
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
];
var WOPN_ABI = [
  'function deposit() payable',  // 0xd0e30db0
  'function withdraw(uint256 wad)'  // 0x2e1a7d4d
];

// Colors & Logs
function colorSuccess(text) { return chalk.greenBright(text); }
function colorError(text) { return chalk.redBright(text); }
function colorWarning(text) { return chalk.yellowBright(text); }
function colorInfo(text) { return chalk.cyanBright(text); }
function colorDim(text) { return chalk.gray(text); }
function colorBold(text) { return chalk.bold(text); }

function logSuccess(message) { console.log(colorSuccess('✅ ' + message)); }
function logError(message) { console.error(colorError('❌ ' + message)); }
function logInfo(message) { console.log(colorInfo(message)); }
function logWarning(message) { console.log(colorWarning(message)); }
function logDim(message) { console.log(colorDim(message)); }
function logBold(message) { console.log(colorBold(message)); }

function promptBold(message) { return colorBold(message); }

// Loading
function showLoading(message, callback) {
  logWarning('⏳ ' + message);
  setTimeout(() => { logSuccess(message + ' OK'); if (callback) callback(); }, 1000);
}

// Provider
function createProvider(proxy) {
  if (!proxy) return new ethers.JsonRpcProvider(RPC_URL);
  try {
    var agent = new HttpsProxyAgent('http://' + proxy);
    return new ethers.JsonRpcProvider(RPC_URL, null, { agent });
  } catch (e) {
    logWarning('Proxy fail: ' + (proxy ? proxy.slice(0, 20) + '... -> direct' : 'No proxy'));
    return new ethers.JsonRpcProvider(RPC_URL);
  }
}

// Read files
function readFiles(callback) {
  showLoading('Reading files', () => {
    fs.readFile('private_keys.txt', 'utf8', (err, pkContent) => {
      if (err) { logError('private_keys.txt missing!'); process.exit(1); }
      fs.readFile('proxies.txt', 'utf8', (err, proxyContent) => {
        var privateKeys = pkContent.trim().split('\n').map(k => k.trim()).filter(k => k && !k.startsWith('#'));
        var proxies = err ? [] : proxyContent.trim().split('\n').map(p => p.trim()).filter(p => p && !p.startsWith('#'));
        if (privateKeys.length === 0) { logError('No keys!'); process.exit(1); }
        logInfo('Loaded: ' + privateKeys.length + ' wallets, ' + proxies.length + ' proxies');
        if (proxies.length && privateKeys.length !== proxies.length) logWarning('Cycling proxies');
        callback(privateKeys, proxies);
      });
    });
  });
}

// Wallet info
function getWalletInfo(privateKey, proxy, callback) {
  var provider = createProvider(proxy);
  var wallet = new ethers.Wallet(privateKey, provider);
  logInfo('Wallet: ' + wallet.address);
  provider.getBalance(wallet.address).then(balance => {
    var native = parseFloat(ethers.formatEther(balance)).toFixed(6);
    logInfo('OPN: ' + native);
    var tokens = [OPNT, TUSDT, TBNB /*, WOPN if added */];
    var tokenBalances = {};
    var checked = 0;
    tokens.forEach(token => {
      var erc20Abi = [...TOKEN_ABI, 'function symbol() view returns (string)'];
      var contract = new ethers.Contract(token, erc20Abi, provider);
      contract.balanceOf(wallet.address).then(bal => {
        contract.decimals().then(decimals => {
          var formatted = parseFloat(ethers.formatUnits(bal, decimals)).toFixed(8);
          if (parseFloat(formatted) > 0) {
            tokenBalances[token] = { balance: formatted, decimals: decimals };
            logInfo((TOKEN_SYMBOLS[token] || 'Token') + ': ' + formatted);
          }
          checked++;
          if (checked === tokens.length) {
            logSuccess('Wallet ready');
            callback({ native: native, tokens: tokenBalances, address: wallet.address, wallet: wallet, provider: provider });
          }
        }).catch(() => { checked++; if (checked === tokens.length) callback({ native, tokens: tokenBalances, address: wallet.address, wallet, provider }); });
      }).catch(() => { checked++; if (checked === tokens.length) callback({ native, tokens: {}, address: wallet.address, wallet, provider }); });
    });
  }).catch(err => { logError('Wallet error: ' + err.message); callback(null); });
}

var TOKEN_SYMBOLS = { [OPNT]: 'OPNT', [TUSDT]: 'TUSDT', [TBNB]: 'tBNB' /*, [WOPN]: 'WOPN' */ };

// Approve token with allowance check & nonce retry
async function approveToken(wallet, provider, token, amountIn, symbol) {
  var contract = new ethers.Contract(token, TOKEN_ABI, wallet);
  try {
    var allowance = await contract.allowance(wallet.address, SWAP_CONTRACT);
    if (allowance >= amountIn) {
      logInfo('Allowance OK for ' + symbol + ' – skipping approve');
      return;
    }
    // Fresh nonce
    var nonce = await provider.getTransactionCount(wallet.address, 'pending');
    var tx = await contract.approve(SWAP_CONTRACT, amountIn, { 
      gasLimit: 100000, 
      gasPrice: MAX_GAS_PRICE,
      nonce: nonce 
    });
    logInfo('Approve ' + symbol + ': ' + tx.hash);
    await tx.wait();
    logSuccess('Approved ' + symbol);
  } catch (e) {
    if (e.message && e.message.includes('invalid nonce')) {
      logWarning('Nonce error on approve ' + symbol + ' – retry with +1');
      var retryNonce = await provider.getTransactionCount(wallet.address, 'pending');
      var txRetry = await contract.approve(SWAP_CONTRACT, amountIn, { 
        gasLimit: 100000, 
        gasPrice: MAX_GAS_PRICE,
        nonce: retryNonce + 1 
      });
      logInfo('Approve retry ' + symbol + ': ' + txRetry.hash);
      await txRetry.wait();
      logSuccess('Approved ' + symbol + ' (retry)');
    } else {
      logError('Approve ' + symbol + ' failed: ' + (e.reason || e.message));
      throw e;
    }
  }
}

// Forward swap: Random 0.5-1.5% OPN + liquidity check (low threshold)
async function performForwardSwap(info, token, num, total) {
  var pair = SWAP_PAIRS.find(p => p.output === token);
  if (!pair) { logError('Bad pair'); return false; }
  logInfo('Forward ' + num + '/' + total + ': OPN → ' + pair.symbol);

  var nativeBalance = parseFloat(info.native);
  if (nativeBalance < 0.002) { logError('Low OPN: ' + nativeBalance); return false; }

  // Random percent with tolerance
  var randomPercent = FORWARD_PERCENT_BASE - FORWARD_TOLERANCE + (Math.random() * (FORWARD_TOLERANCE * 2));
  var amountPercent = nativeBalance * randomPercent;
  if (amountPercent < 0.001) { amountPercent = 0.001; randomPercent = amountPercent / nativeBalance; }
  var amountIn = ethers.parseEther(amountPercent.toFixed(6));
  logInfo('Random amount: ' + amountPercent.toFixed(6) + ' OPN (' + (randomPercent * 100).toFixed(1) + '% of balance)');

  var retryAttempt = 0;  // For retry logic
  while (retryAttempt < 2) {  // Max 2 tries
    try {
      var router = new ethers.Contract(SWAP_CONTRACT, ROUTER_ABI, info.provider);
      var path = [WOPN, token];

      // Liquidity check (low threshold)
      var amountsOut = await router.getAmountsOut(amountIn, path);
      var expectedOutStr = ethers.formatUnits(amountsOut[1], pair.decimals);
      logInfo('Expected out: ' + expectedOutStr + ' ' + pair.symbol);
      if (amountsOut[1] < MIN_LIQUIDITY_OUT && amountsOut[1] > 0n) {
        logWarning('Low but positive liquidity for ' + pair.symbol + ' (' + expectedOutStr + ') – proceeding with caution');
        // Still try, but lower slippage for safety
      } else if (amountsOut[1] === 0n) {
        logError('Zero liquidity for ' + pair.symbol + ' – skipping');
        return false;
      }

      var slippageFactor = retryAttempt === 0 ? SLIPPAGE : 500n;  // 95% first, 50% retry
      var amountOutMin = (amountsOut[1] * slippageFactor) / 1000n;
      var deadline = Math.floor(Date.now() / 1000) + (DEADLINE_MINUTES * 60);

      // AbiCoder encode (like original)
      var abiCoder = ethers.AbiCoder.defaultAbiCoder();
      var data = '0xa24fefef' + abiCoder.encode(
        ['uint256', 'address[]', 'address', 'uint256'],
        [amountOutMin, path, info.address, deadline]
      ).slice(2);

      // Gas
      var gasPrice = await getGasPrice(info.provider);
      logInfo('Gas: ' + ethers.formatUnits(gasPrice, 'gwei') + ' gwei');

      // Nonce
      var nonce = await info.provider.getTransactionCount(info.address, 'pending');

      // TX
      var tx = await info.wallet.sendTransaction({
        to: SWAP_CONTRACT,
        data: data,
        value: amountIn,
        gasLimit: GAS_LIMIT,
        gasPrice: gasPrice,
        nonce: nonce,
        chainId: CHAIN_ID
      });

      logSuccess('Forward TX: ' + tx.hash + ' | View: https://testnet.iopn.tech/tx/' + tx.hash);
      var receipt = await tx.wait(1);
      if (receipt.status === 1) {
        logSuccess('✅ Forward success | Gas used: ' + receipt.gasUsed + ' | Block: ' + receipt.blockNumber);
        return true;
      } else {
        logError('❌ Forward reverted | Gas wasted: ' + receipt.gasUsed);
        if (receipt.logs.length === 0) logWarning('No logs – likely slippage/liquidity');
        retryAttempt++;
        if (retryAttempt < 2) {
          logWarning('Retrying with lower slippage (' + slippageFactor / 10n + '% min)...');
          continue;  // Retry loop
        }
        return false;
      }
    } catch (e) {
      logError('Forward error: ' + (e.shortMessage || e.reason || e.message || 'Funds/liquidity?'));
      if (e.message && (e.message.includes('execution reverted') || e.message.includes('insufficient'))) {
        retryAttempt++;
        if (retryAttempt < 2) {
          logWarning('Reverted – retrying with lower slippage...');
          continue;
        }
      }
      return false;
    }
  }
  return false;
}

// Reverse swap: Random 5-15% token + liquidity check (low threshold)
async function performReverseSwap(info, token, symbol, balance, decimals) {
  logInfo('Reverse: ' + symbol + ' → OPN');

  // Random percent with tolerance
  var randomPercent = REVERSE_PERCENT_BASE - REVERSE_TOLERANCE + (Math.random() * (REVERSE_TOLERANCE * 2));
  var amountPercent = parseFloat(balance) * randomPercent;
  if (amountPercent <= 0.000001) { logWarning('No/low balance for reverse'); return false; }
  var amountIn = ethers.parseUnits(amountPercent.toFixed(8), decimals);
  logInfo('Random amount: ' + amountPercent.toFixed(8) + ' ' + symbol + ' (' + (randomPercent * 100).toFixed(1) + '% of balance)');

  var retryAttempt = 0;
  while (retryAttempt < 2) {
    try {
      var gasPrice = await getGasPrice(info.provider);

      // Liquidity check for reverse (low threshold)
      if (token !== WOPN) {
        var router = new ethers.Contract(SWAP_CONTRACT, ROUTER_ABI, info.provider);
        var path = [token, WOPN];
        var amountsOut = await router.getAmountsOut(amountIn, path);
        logInfo('Expected OPN out: ' + ethers.formatEther(amountsOut[1]));
        if (amountsOut[1] < MIN_LIQUIDITY_OUT / 100n && amountsOut[1] > 0n) {  // ~0.00001 OPN
          logWarning('Low but positive reverse liquidity for ' + symbol + ' – proceeding');
        } else if (amountsOut[1] === 0n) {
          logWarning('Zero reverse liquidity for ' + symbol + ' – skipping');
          return false;
        }
      }

      // If WOPN, special unwrap
      if (token === WOPN) {
        var abiCoder = ethers.AbiCoder.defaultAbiCoder();
        var data = '0x2e1a7d4d' + abiCoder.encode(['uint256'], [amountIn]).slice(2);
        var nonce = await info.provider.getTransactionCount(info.address, 'pending');
        var tx = await info.wallet.sendTransaction({
          to: WOPN,
          data: data,
          value: 0,
          gasLimit: GAS_LIMIT,
          gasPrice: gasPrice,
          nonce: nonce,
          chainId: CHAIN_ID
        });
        logSuccess('Reverse TX (unwrap): ' + tx.hash + ' | View: https://testnet.iopn.tech/tx/' + tx.hash);
        var receipt = await tx.wait(1);
        if (receipt.status === 1) {
          logSuccess('✅ Reverse (unwrap) success | Gas used: ' + receipt.gasUsed + ' | Block: ' + receipt.blockNumber);
          return true;
        } else {
          logError('❌ Reverse (unwrap) reverted | Gas wasted: ' + receipt.gasUsed);
          return false;
        }
      } else {
        // Approve with check
        await approveToken(info.wallet, info.provider, token, amountIn, symbol);

        // Get amountsOut
        var router = new ethers.Contract(SWAP_CONTRACT, ROUTER_ABI, info.provider);
        var path = [token, WOPN];
        var amountsOut = await router.getAmountsOut(amountIn, path);
        var slippageFactor = retryAttempt === 0 ? SLIPPAGE : 500n;
        var amountOutMin = (amountsOut[1] * slippageFactor) / 1000n;
        var deadline = Math.floor(Date.now() / 1000) + (DEADLINE_MINUTES * 60);

        // AbiCoder encode
        var abiCoder = ethers.AbiCoder.defaultAbiCoder();
        var data = '0xe0f44df2' + abiCoder.encode(
          ['uint256', 'uint256', 'address[]', 'address', 'uint256'],
          [amountIn, amountOutMin, path, info.address, deadline]
        ).slice(2);

        // Nonce
        var nonce = await info.provider.getTransactionCount(info.address, 'pending');
        var tx = await info.wallet.sendTransaction({
          to: SWAP_CONTRACT,
          data: data,
          value: 0,
          gasLimit: GAS_LIMIT,
          gasPrice: gasPrice,
          nonce: nonce,
          chainId: CHAIN_ID
        });

        logSuccess('Reverse TX: ' + tx.hash + ' | View: https://testnet.iopn.tech/tx/' + tx.hash);
        var receipt = await tx.wait(1);
        if (receipt.status === 1) {
          logSuccess('✅ Reverse success | Gas used: ' + receipt.gasUsed + ' | Block: ' + receipt.blockNumber);
          return true;
        } else {
          logError('❌ Reverse reverted | Gas wasted: ' + receipt.gasUsed);
          retryAttempt++;
          if (retryAttempt < 2) {
            logWarning('Retrying reverse with lower slippage...');
            continue;
          }
          return false;
        }
      }
    } catch (e) {
      logError('Reverse error: ' + (e.shortMessage || e.reason || e.message));
      retryAttempt++;
      if (retryAttempt < 2 && (e.message.includes('reverted') || e.message.includes('insufficient'))) {
        logWarning('Reverse reverted – retrying...');
        continue;
      }
      return false;
    }
  }
  return false;
}

// Gas helper
async function getGasPrice(provider) {
  try {
    var fees = await provider.getFeeData();
    var gasPrice = fees.gasPrice || BASE_GAS_PRICE;
    if (gasPrice < MIN_GAS_PRICE) gasPrice = MAX_GAS_PRICE;
    else if (gasPrice > MAX_GAS_PRICE) gasPrice = MAX_GAS_PRICE;
    return gasPrice;
  } catch (e) {
    logWarning('Fee error, fallback 15 gwei');
    return MAX_GAS_PRICE;
  }
}

// Process wallet: forwards + reverses (sequential reverses + random delays)
let globalNumSwaps = 3;  // Default & saved for cycles
let isFirstCycle = true;  // Prompt only first time
function processWallet(privateKey, proxy, index, total, privateKeys, proxies, numSwaps = globalNumSwaps) {
  globalNumSwaps = numSwaps;  // Update saved
  getWalletInfo(privateKey, proxy, info => {
    if (!info) return processNextWallet();

    logBold('Wallet ' + (index + 1) + '/' + total + ': ' + info.address.slice(0, 10) + '... (OPN: ' + info.native + ')');

    var availTokens = Object.keys(info.tokens).filter(t => parseFloat(info.tokens[t].balance) > 0);
    if (availTokens.length === 0 && parseFloat(info.native) < 0.002) {
      logWarning('Low balances – skip');
      return processNextWallet();
    }
    logInfo('Available for forward: OPN (' + info.native + ')');

    // Prompt only on first cycle
    if (isFirstCycle) {
      var numSwapsInput = readlineSync.question(promptBold('Forward swaps? (1-50, def 3): '), { defaultInput: '3' });
      globalNumSwaps = parseInt(numSwapsInput) || 3;
      if (globalNumSwaps > 50) globalNumSwaps = 3;
      isFirstCycle = false;
    }
    logInfo('Running ' + globalNumSwaps + ' forward swaps...');

    var performedTokens = new Set();  // Track unique for reverse
    var success = 0, fails = 0, current = 0;

    async function nextForward() {
      current++;
      if (current > globalNumSwaps) {
        logBold('Forwards done: ' + success + '/' + globalNumSwaps);
        // Reverse phase (sequential)
        logInfo('Starting reverses (random % of ' + performedTokens.size + ' tokens)...');
        await performReverses();
        return;
      }

      var token = SWAP_PAIRS[Math.floor(Math.random() * SWAP_PAIRS.length)].output;
      performedTokens.add(token);
      var ok = await performForwardSwap(info, token, current, globalNumSwaps);
      if (ok) success++; else fails++;
      // Random delay 5-30s
      var delay = Math.random() * 25000 + 5000;
      logDim('Waiting ' + Math.round(delay / 1000) + 's before next forward...');
      await new Promise(resolve => setTimeout(resolve, delay));
      await nextForward();
    }

    async function performReverses() {
      var reverseSuccess = 0;
      var tokenList = Array.from(performedTokens);
      for (let i = 0; i < tokenList.length; i++) {
        var token = tokenList[i];
        var pair = SWAP_PAIRS.find(p => p.output === token);
        if (!pair) continue;
        // Fresh balance
        var contract = new ethers.Contract(token, TOKEN_ABI, info.provider);
        var bal = await contract.balanceOf(info.address);
        var balance = parseFloat(ethers.formatUnits(bal, pair.decimals));
        if (balance > 0.000001) {
          var ok = await performReverseSwap(info, token, pair.symbol, balance, pair.decimals);
          if (ok) reverseSuccess++;
        }
        // Random delay between reverses 5-30s
        if (i < tokenList.length - 1) {
          var delay = Math.random() * 25000 + 5000;
          logDim('Waiting ' + Math.round(delay / 1000) + 's before next reverse...');
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      logBold('Reverses done: ' + reverseSuccess + '/' + tokenList.length);
      setTimeout(() => getWalletInfo(privateKey, proxy, final => {
        logInfo('Final OPN: ' + final.native);
        processNextWallet();
      }), 3000);
    }

    nextForward();

    function processNextWallet() {
      if (index + 1 < total) {
        var nextProxy = proxies[(index + 1) % proxies.length] || null;
        var delay = Math.random() * 50000 + 10000;  // 10-60s random
        logDim('Waiting ' + Math.round(delay / 1000) + 's before next wallet...');
        setTimeout(() => processWallet(privateKeys[index + 1], nextProxy, index + 1, total, privateKeys, proxies, globalNumSwaps), delay);
      } else {
        logSuccess('Cycle complete! Resting 24h before repeat (' + globalNumSwaps + ' swaps)...');
        // Test: CYCLE_REST_MS = 30000; // 30s for debug
        setTimeout(() => {
          logInfo('Starting new 24h cycle (' + globalNumSwaps + ' swaps)...');
          processWallets(privateKeys, proxies, globalNumSwaps);  // Repeat with saved numSwaps, no prompt
        }, CYCLE_REST_MS);
      }
    }
  });
}

// Start
function processWallets(privateKeys, proxies, numSwaps = 3) {
  globalNumSwaps = numSwaps;  // Init saved
  var proxy = proxies[0] || null;
  processWallet(privateKeys[0], proxy, 0, privateKeys.length, privateKeys, proxies, numSwaps);
}

function startBot() {
  console.clear();
  var banner = colorBold(chalk.magentaBright(
    '\n╔══════════════════════════════════════════════════════╗\n║      🚀 OPN Farming Bot v5.1 (ostadkachal)      ║\n║      Network: OPN Testnet (984) - Forward+Reverse   ║\n║      Status: TxGod mod is actived 🪂          ║\n╚══════════════════════════════════════════════════════╝\n'
  ));
  console.log(banner);

  readFiles((privateKeys, proxies) => {
    logSuccess('Bot ready: ' + privateKeys.length + ' wallets');
    logInfo('Press Ctrl+C to stop');
    processWallets(privateKeys, proxies);
  });
}

process.on('SIGINT', () => { logWarning('👋 Shutting down...'); process.exit(0); });
process.on('uncaughtException', e => { logError('Crash: ' + e.message); process.exit(1); });
process.on('unhandledRejection', e => { logError('Rejection: ' + e); });

startBot();
