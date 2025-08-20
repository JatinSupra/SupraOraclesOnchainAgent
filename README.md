# Supra Integrated Agent

This Agent represents the next generation of DeFi AI featuring Supra's MoveVM, Threshold AI Oracles, and Automation Stack.

## **Key Features**

### **AI Threshold Oracle System**
- **5 Expert AI Agents**: Technical Analyst, Fundamental Analyst, Risk Manager, Macro Analyst, and Quantitative Trader
- **Consensus-Based Decisions**: Requires 60% agreement and 70% confidence for automation
- **Investment Execution**: Automatic TestCoin token purchases on any crypto user want to get based on expert consensus.

### **Supra L1**
- **Live Oracle Data**: Real-time price feeds from Supra Oracle Network
- **On-Chain Recording**: Every analysis permanently recorded on Supra blockchain

## **How It Works**

1. **Market Analysis**: Fetches live data from Supra Oracle and analyzes with GPT.
2. **Expert Consensus**: 5 AI specialists vote on trading decisions from their expertise
3. **Automated Execution**: When experts agree, automatically buys with $SUPRA → TestCoin (TestCoin representing any Crypto)
4. **On-Chain Recording**: All decisions and trades recorded permanently on blockchain

## **Prerequisites**

1. [**Supra Oracle API Key**](https://docs.supra.com/) - For live price data
2. [**OpenAI API Key**](https://platform.openai.com/) - For AI analysis and expert consensus

## **Setup & Installation**

#### **Clone and Install**
```bash
git clone https://github.com/JatinSupra/SupraOraclesOnchainAgent
cd SupraOraclesOnchainAgent
npm install
```

#### **Set Environment Variables in .env file**

```bash
SUPRA_ORACLE_API_KEY="your_supra_oracle_api_key_here"
OPENAI_API_KEY="your_openai_api_key_here"
```

#### **Run the Agent**
```bash
npm start
```

> **NOTE:** The agent automatically creates a Supra testnet account (saved to `account.json`) and connects to all services.

## **Commands Reference**

### `analyze btc` / `analyze eth` / `analyze sol`

Performs comprehensive AI analysis with expert consensus:

```bash
Your Commands> analyze eth

=== ANALYZING ETH_USDT ===
Fetching live data for ETH_USDT...
✅ Live data: ETH_USDT = $4,272.70
Fetching 24h historical data for ETH_USDT...
✅ Historical data: 24 data points
Analyzing market data...
✅ Analysis completed
AI THRESHOLD ORACLE panel...
Each expert analyzing from their specialty...
Expert votes: 5 BUY, 0 SELL, 0 HOLD
✅ Decision: BUY (87% confidence)

=== PRICE DATA ===
Current Price: 4272.70
24h Change: 8.01%
24h High: 4565.69
24h Low: 4227.23

=== ANALYSIS ===
Recommendation: + BUY
Confidence: 87%
Reasoning: Strong positive momentum indicated by significant 24-hour price increase

=== AI THRESHOLD Oracle ANALYSIS ===
┌─────────────────────────┬──────────┬────────────┬──────────────────────────────────┐
│ Expert                  │ Decision │ Confidence │ Reasoning                        │
├─────────────────────────┼──────────┼────────────┼──────────────────────────────────┤
│ Technical Analyst       │ BUY      │ 85%        │ Strong positive momentum indica... │
│ Fundamental Analyst     │ BUY      │ 85%        │ Positive market sentiment driv... │
│ Risk Manager           │ BUY      │ 90%        │ Strong positive momentum and su... │
│ Macro Analyst          │ BUY      │ 85%        │ Positive market sentiment; stro... │
│ Quant Trader           │ BUY      │ 90%        │ Strong positive momentum indica... │
└─────────────────────────┴──────────┴────────────┴──────────────────────────────────┘

Consensus: BUY (100% agreement, 87% confidence)
Execute Investment: ✅ YES
```

### `show portfolio`

View your complete trading portfolio and status:

```bash
=== SUPRA AGENT PORTFOLIO ===
SUPRA Balance: 41998.05 SUPRA
SupraAgent Investment: 142.0000 TestCoin
Investment Progress: 2/2 SUPRA
Total DCA Swaps: 2
Automation Status: ✅ ACTIVE
Analysis History: 1 completed
Auto-Trading: ✅ ENABLED
AI THRESHOLD Oracle: ✅ ENABLED

=== RECENT SIGNALS ===
1. BTC_USDT: BUY (85%) (Experts: BUY)
```

### `show tasks`

Monitor active AgentETH automation tasks:

```bash
=== SUPRA AGENT AUTOMATION TASKS ===
Task: supraagent_108210af
Trigger: SOL_USDT signal
Budget: 100 SUPRA (20 per swap)
Interval: 300s between swaps
Progress: 2/2 SUPRA (100.0%)
SupraAgent Earned: 142.0000 TestCoin
Swaps: 2 completed
Status: COMPLETED
Next Swap: WAITING
TX: https://testnet.suprascan.io/tx/0x87ca04d3c27d575d78d7241d417012d52ebb1c60de52f65a55dcbee5108210af
```

### `enable auto trading`

Activate autonomous trading based on AI expert consensus:

```bash
Auto-trading ENABLED
Auto-trading will invest in TestCoin when experts agree
Max investment per signal: 400 SUPRA
TestCoin represents your diversified investment portfolio
```

### `enable experts`

Toggle the AI Threshold Oracle system:

```bash
AI THRESHOLD Oracle ENABLED
5 trading experts will vote on TestCoin investments
```

### Additional Commands

- `fund account` - Get free testnet SUPRA tokens
- `config` - View agent configuration
- `help` - Show all available commands
- `exit` - Quit the application


## TestCoin Token System

**TestCoin** is the investment token representing your AI-driven portfolio:

- **Automated DCA**: SUPRA tokens convert to TestCoin over time
- **Expert-Driven**: Only purchased when AI experts reach consensus
- **Trackable**: Monitor exact TestCoin holdings and conversion progress
- **Universal**: Represents all crypto investment signals in one token

## 🔗 **Supra Blockchain Features**

- **Testnet Explorer**: [https://testnet.suprascan.io](https://testnet.suprascan.io)
- **Transaction Tracking**: Every analysis and trade recorded on-chain
- **Automation System**: Trustless DCA execution via smart contracts
- **Account Management**: Automatic wallet creation and balance tracking

## **Configuration**

Default settings optimized for automated trading:

- **Risk Level**: MEDIUM
- **Max Investment**: 400 SUPRA per signal
- **Confidence Threshold**: 70%
- **DCA Strategy**: 2 swaps every 2 seconds
- **Slippage Tolerance**: 4%