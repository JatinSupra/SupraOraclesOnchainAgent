# Supra Oracles Onchain Agent
This agent represents the next generation of DeFi AI Agentic Feature showcasing Supra's MoveVM and Oracles Integration Stack:

- Live price feeds from Supra Oracle.
- GPT 3.5-turbo analyzes market conditions and provides trading recommendation.
- Every analysis is permanently recorded on Supra as Transaction.
- Optional auto-trading based on AI confidence levels.
- Track performance and analysis history


### **Supra Oracles**
- **REST API**: Fetches live price data and 24h historical data
- **Supported Pairs**: BTC_USDT, ETH_USDT, SUPRA_USDT, and more

### **OpenAI GPT Integration**
- **Model**: GPT-3.5-turbo for intelligent market analysis
- **Input**: Live prices, historical data, technical indicators
- **Output**: Trading recommendations with confidence scores and reasoning recomm.

### **Supra SDK Infra**
- Wallet Creation & Account operations
- On-chain Record Proof of Every Analysis
- Real-time SUPRA balance tracking

## Prerequisites
1. [**Supra x-API Key**](https://docs.supra.com/)
2. [**OpenAI API Key**](https://platform.openai.com/)


## **Setup & Running Agent**

#### **Clone and Install**

```bash
git clone https://github.com/JatinSupra/SupraOraclesOnchainAgent
cd SupraOraclesOnchainAgent
npm install
```

#### **Set Environment Variables**

```bash
export SUPRA_ORACLE_API_KEY="your_supra_oracle_api_key_here"
export OPENAI_API_KEY="your_openai_api_key_here"
```

#### **Run the Agent**
```bash
npx tsx agent.ts
```

> **NOTE:** *The Agent will Automatically Create a new Supra testnet account (saved to `account.json`) & Connect to Supra testnet along with Initializing Oracle and GPT services*

## Commands Reference

#### `analyze BTC/ETH/SUPRA`

1. Fetches live price data from Supra Oracle
2. Retrieves 24h historical data for technical analysis
3. Uses GPT-3.5-turbo to analyze market conditions
4. Records the analysis as a blockchain transaction
5. If auto-trading is enabled, executes trades based on confidence


```bash
🤖 Command to Agent> analyze BTC

🔍 === ANALYZING BTC_USDT ===
🔄 Fetching live data for BTC_USDT...
✅ Live data fetched: BTC_USDT = $117,778.00
📊 Fetching 24h historical data for BTC_USDT...
🤖 GPT analyzing market data...
✅ GPT analysis completed

📊 === PRICE DATA ===
Current Price: $117,778.00
24h Change: 4.81%
24h High: $118,837.07
24h Low: $113,380.11

🤖 === AI ANALYSIS ===
Recommendation: 📈 BUY
Confidence: 75%
Reasoning: Technical indicators show oversold conditions with potential for recovery
Target Price: $121,500.00
Stop Loss: $115,000.00

⛓️ Recording analysis on Supra blockchain...
✅ Analysis recorded on-chain
🔗 Transaction: https://testnet.suprascan.io/tx/0xd54915c680aee531...
```

#### `show portfolio`

- SUPRA balance
- Analysis history count
- Agent configuration status
- Recent analysis results

```bash
💼 === PORTFOLIO STATUS ===
SUPRA Balance: 500.00 SUPRA
Analysis History: 3 completed
Auto-Trading: ✅ ENABLED
GPT Analysis: ✅ ENABLED
On-Chain Recording: ✅ ENABLED

📈 === RECENT ANALYSES ===
1. BTC_USDT: BUY (75%)
2. ETH_USDT: SELL (68%)
3. SUPRA_USDT: HOLD (45%)
```

#### `check balance`

```bash
💰 Account Balance: 500.00 SUPRA
```

#### `enable auto trading` / `disable auto trading`

- Only executes trades with >70% confidence
- Records every trade on-chain
- Configurable position sizes and risk limits

```bash
🤖 Auto-trading ENABLED
⚠️ Auto-trading will execute trades based on AI analysis
💰 Max investment per trade: $100
```

#### `show agent configs`

- GPT analysis status
- On-chain recording status
- Auto-trading status
- Risk management settings

```bash
⚙️ === AGENT CONFIGURATION ===
{
  "enableGPTAnalysis": true,
  "enableOnChainRecording": true,
  "enableAutoTrading": true,
  "riskLevel": "MEDIUM",
  "maxInvestmentPerTrade": 100
}
```

#### `fund account`

- Requests SUPRA tokens from testnet faucet
- Updates balance automatically

```bash
💸 Requesting testnet funds...
✅ Funding request submitted - check balance in 30 seconds
```

#### `help`
#### `exit`