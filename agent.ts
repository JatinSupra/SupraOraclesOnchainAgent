import readline from 'readline';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import axios from 'axios';
import OpenAI from 'openai';
import { SupraClient, SupraAccount, HexString } from 'supra-l1-sdk';
import * as dotenv from 'dotenv';
dotenv.config();


interface AnalysisConfig {
  enableGPTAnalysis: boolean;
  enableOnChainRecording: boolean;
  enableAutoTrading: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  maxInvestmentPerTrade: number;
}

interface PriceData {
  tradingPair: string;
  currentPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  timestamp: string;
}

interface AnalysisResult {
  pair: string;
  analysis: string;
  recommendation: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidence: number;
  reasoning: string;
  targetPrice?: number;
  stopLoss?: number;
  timeframe: string;
}

class SupraOracleService {
  private baseUrl: string = 'https://prod-kline-rest.supra.com';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getLatestPrice(tradingPair: string): Promise<PriceData | null> {
    try {
      console.log(chalk.blue(`🔄 Fetching live data for ${tradingPair.toUpperCase()}...`));
      
      const response = await axios.get(`${this.baseUrl}/latest`, {
        params: { trading_pair: tradingPair },
        headers: { 'x-api-key': this.apiKey },
        timeout: 10000
      });

      if (response.data?.instruments?.[0]) {
        const instrument = response.data.instruments[0];
        const priceData: PriceData = {
          tradingPair: tradingPair,
          currentPrice: parseFloat(instrument.currentPrice),
          change24h: parseFloat(instrument['24h_change'] || '0'),
          high24h: parseFloat(instrument['24h_high']),
          low24h: parseFloat(instrument['24h_low']),
          timestamp: instrument.timestamp || new Date().toISOString()
        };
        
        console.log(chalk.green(`✅ Live data fetched: ${tradingPair.toUpperCase()} = $${priceData.currentPrice.toFixed(2)}`));
        return priceData;
      }
      return null;
    } catch (error: any) {
      console.error(chalk.red(`❌ Error fetching ${tradingPair}:`));
      if (error.response?.status === 401 || error.response?.status === 403) {
        console.error(chalk.red('🔑 API key authentication failed'));
      } else if (error.response) {
        console.error(chalk.red(`Status: ${error.response.status}`));
      } else {
        console.error(chalk.red(error.message));
      }
      return null;
    }
  }

  async getHistoricalData(tradingPair: string, hoursBack: number = 24): Promise<any[]> {
    try {
      const endDate = Date.now();
      const startDate = endDate - (hoursBack * 60 * 60 * 1000);
      
      console.log(chalk.blue(`📊 Fetching ${hoursBack}h historical data for ${tradingPair.toUpperCase()}...`));
      
      const response = await axios.get(`${this.baseUrl}/history`, {
        params: {
          trading_pair: tradingPair,
          startDate,
          endDate,
          resolution: 3600
        },
        headers: { 'x-api-key': this.apiKey },
        timeout: 15000
      });

      if (response.data?.data) {
        console.log(chalk.green(`✅ Historical data fetched: ${response.data.data.length} data points`));
        return response.data.data;
      }
      return [];
    } catch (error: any) {
      console.error(chalk.red(`❌ Error fetching historical data for ${tradingPair}:`), error.message);
      return [];
    }
  }
}

class GPTAnalysisService {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async analyzeMarketData(priceData: PriceData, historicalData: any[]): Promise<AnalysisResult> {
    try {
      console.log(chalk.blue('🤖 GPT analyzing market data...'));

      const prompt = this.buildAnalysisPrompt(priceData, historicalData);
      
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a professional crypto market analyst. Analyze the provided data and give specific trading recommendations with clear reasoning."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.3
      });

      const analysis = completion.choices[0].message.content || '';
      console.log(chalk.green('✅ GPT analysis completed'));
      
      return this.parseGPTResponse(priceData.tradingPair, analysis);
    } catch (error: any) {
      console.error(chalk.red('❌ GPT analysis failed:'), error.message);
      return {
        pair: priceData.tradingPair,
        analysis: 'Analysis failed - using basic technical indicators',
        recommendation: 'HOLD',
        confidence: 0.3,
        reasoning: 'Could not perform AI analysis',
        timeframe: '24h'
      };
    }
  }

  private buildAnalysisPrompt(priceData: PriceData, historicalData: any[]): string {
    const prices = historicalData.map(d => parseFloat(d.close)).slice(-24);  
    const volumes = historicalData.map(d => parseFloat(d.volume || '0')).slice(-24);
    
    return `
Analyze this crypto trading data for ${priceData.tradingPair.toUpperCase()}:

CURRENT DATA:
- Price: $${priceData.currentPrice}
- 24h Change: ${priceData.change24h}%
- 24h High: $${priceData.high24h}
- 24h Low: $${priceData.low24h}

HISTORICAL PRICES (last 24 hours): ${prices.join(', ')}
VOLUME DATA: ${volumes.join(', ')}

TECHNICAL INDICATORS:
- SMA(10): ${this.calculateSMA(prices, 10)}
- RSI(14): ${this.calculateRSI(prices, 14)}
- Volatility: ${this.calculateVolatility(prices)}%

Please provide:
1. Overall market sentiment (STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL)
2. Confidence level (0-1)
3. Key reasoning points
4. Target price (if buying/selling)
5. Stop loss level
6. Recommended timeframe

Format your response clearly with your recommendation and reasoning.
`;
  }

  private parseGPTResponse(pair: string, analysis: string): AnalysisResult {
    const recommendations = ['STRONG_BUY', 'STRONG_SELL', 'BUY', 'SELL', 'HOLD'];
    let recommendation: any = 'HOLD';
    
    for (const rec of recommendations) {
      if (analysis.toUpperCase().includes(rec)) {
        recommendation = rec;
        break;
      }
    }
    const confidenceMatch = analysis.match(/confidence[:\s]*(\d+\.?\d*)/i) || 
                           analysis.match(/(\d+\.?\d*)%/);
    let confidence = 0.5;
    if (confidenceMatch) {
      confidence = Math.min(parseFloat(confidenceMatch[1]) / 100, 1);
    }

    const targetMatch = analysis.match(/target[:\s]*\$?(\d+\.?\d*)/i);
    const targetPrice = targetMatch ? parseFloat(targetMatch[1]) : undefined;
    const stopMatch = analysis.match(/stop[:\s]*\$?(\d+\.?\d*)/i);
    const stopLoss = stopMatch ? parseFloat(stopMatch[1]) : undefined;

    return {
      pair,
      analysis,
      recommendation,
      confidence,
      reasoning: analysis.split('\n').slice(0, 3).join(' '),
      targetPrice,
      stopLoss,
      timeframe: '24h'
    };
  }

  private calculateSMA(prices: number[], period: number): number {
    const slice = prices.slice(-period);
    return slice.reduce((sum, price) => sum + price, 0) / slice.length;
  }
  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50; 
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }
    const avgGain = gains.slice(-period).reduce((sum, gain) => sum + gain, 0) / period;
    const avgLoss = losses.slice(-period).reduce((sum, loss) => sum + loss, 0) / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateVolatility(prices: number[]): number {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * 100;
  }
}

class OnChainRecorder {
  private supraClient: SupraClient;
  private account: SupraAccount;

  constructor(supraClient: SupraClient, account: SupraAccount) {
    this.supraClient = supraClient;
    this.account = account;
  }

  async recordAnalysis(analysis: AnalysisResult): Promise<string | null> {
    try {
      console.log(chalk.blue('⛓️ Recording analysis on Supra blockchain...'));
      const amount = BigInt(1);
      const txResponse = await this.supraClient.transferSupraCoin(
        this.account,
        this.account.address(),
        amount
      );
      
      console.log(chalk.green('✅ Analysis recorded on-chain'));
      console.log(chalk.cyan(`🔗 Transaction: https://testnet.suprascan.io/tx/${txResponse.txHash}`));
      return txResponse.txHash;
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to record analysis on-chain:'), error.message);
      return null;
    }
  }

  async executeTradeTransaction(action: string, pair: string, amount: number): Promise<string | null> {
    try {
      console.log(chalk.blue(`⛓️ Recording ${action} transaction for ${pair}...`));
      const transferAmount = BigInt(100000);
      const txResponse = await this.supraClient.transferSupraCoin(
        this.account,
        this.account.address(),
        transferAmount
      );
      console.log(chalk.green(`✅ Trade recorded on-chain`));
      console.log(chalk.cyan(`🔗 Transaction: https://testnet.suprascan.io/tx/${txResponse.txHash}`));      
      return txResponse.txHash;
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to record trade on-chain:'), error.message);
      return null;
    }
  }
}

class IntelligentTradingAgent {
  private supraClient: SupraClient;
  private account: SupraAccount;
  private oracleService: SupraOracleService;
  private gptService: GPTAnalysisService | null = null;
  private onChainRecorder: OnChainRecorder;
  private config: AnalysisConfig;
  private analysisHistory: AnalysisResult[] = [];
  constructor(
    supraClient: SupraClient, 
    account: SupraAccount, 
    supraapiKey: string,
    openaiApiKey?: string
  ) {
    this.supraClient = supraClient;
    this.account = account;
    this.oracleService = new SupraOracleService(supraapiKey);
    this.onChainRecorder = new OnChainRecorder(supraClient, account);
    if (openaiApiKey) {
      this.gptService = new GPTAnalysisService(openaiApiKey);
    }

    this.config = {
      enableGPTAnalysis: !!openaiApiKey,
      enableOnChainRecording: true,
      enableAutoTrading: false,
      riskLevel: 'MEDIUM',
      maxInvestmentPerTrade: 500
    };
  }

  async analyzeToken(tradingPair: string): Promise<AnalysisResult | null> {
    try {
      console.log(chalk.cyan.bold(`\n🔍 === ANALYZING ${tradingPair.toUpperCase()} ===`));
      const priceData = await this.oracleService.getLatestPrice(tradingPair);
      if (!priceData) {
        console.log(chalk.red('❌ Could not fetch price data'));
        return null;
      }
      const historicalData = await this.oracleService.getHistoricalData(tradingPair, 24);
      let analysis: AnalysisResult;      
      if (this.config.enableGPTAnalysis && this.gptService) {
        analysis = await this.gptService.analyzeMarketData(priceData, historicalData);
      } else {
        analysis = this.performBasicAnalysis(priceData, historicalData);
      }
      this.displayAnalysis(priceData, analysis);
      if (this.config.enableOnChainRecording) {
        await this.onChainRecorder.recordAnalysis(analysis);
      }
      if (this.config.enableAutoTrading) {
        await this.executeAutoTrade(analysis);
      }
      this.analysisHistory.push(analysis);
      if (this.analysisHistory.length > 10) {
        this.analysisHistory.shift(); 
      }
      return analysis;
    } catch (error: any) {
      console.error(chalk.red('❌ Analysis failed:'), error.message);
      return null;
    }
  }

  private performBasicAnalysis(priceData: PriceData, historicalData: any[]): AnalysisResult {
    const prices = historicalData.map(d => parseFloat(d.close));
    let recommendation: any = 'HOLD';
    let confidence = 0.5;
    let reasoning = 'Basic technical analysis';
    if (priceData.change24h > 5) {
      recommendation = 'SELL';
      confidence = 0.6;
      reasoning = 'Strong 24h gains - potential reversal';
    } else if (priceData.change24h < -5) {
      recommendation = 'BUY';
      confidence = 0.7;
      reasoning = 'Significant 24h drop - potential recovery';
    } else if (prices.length >= 10) {
      const sma10 = prices.slice(-10).reduce((a, b) => a + b) / 10;
      if (priceData.currentPrice > sma10 * 1.02) {
        recommendation = 'SELL';
        confidence = 0.5;
        reasoning = 'Price above 10-period average';
      } else if (priceData.currentPrice < sma10 * 0.98) {
        recommendation = 'BUY';
        confidence = 0.5;
        reasoning = 'Price below 10-period average';
      }
    }
    return {
      pair: priceData.tradingPair,
      analysis: `Basic technical analysis for ${priceData.tradingPair.toUpperCase()}`,
      recommendation,
      confidence,
      reasoning,
      timeframe: '24h'
    };
  }

  private displayAnalysis(priceData: PriceData, analysis: AnalysisResult): void {
    console.log(chalk.cyan('\n📊 === PRICE DATA ==='));
    console.log(chalk.white(`Current Price: $${priceData.currentPrice.toFixed(2)}`));
    console.log(chalk.white(`24h Change: ${priceData.change24h.toFixed(2)}%`));
    console.log(chalk.white(`24h High: $${priceData.high24h.toFixed(2)}`));
    console.log(chalk.white(`24h Low: $${priceData.low24h.toFixed(2)}`));
    console.log(chalk.yellow('\n🤖 === AI ANALYSIS ==='));
    console.log(chalk.white(`Recommendation: ${this.getRecommendationEmoji(analysis.recommendation)} ${analysis.recommendation}`));
    console.log(chalk.white(`Confidence: ${(analysis.confidence * 100).toFixed(0)}%`));
    console.log(chalk.white(`Reasoning: ${analysis.reasoning}`));
    if (analysis.targetPrice) {
      console.log(chalk.white(`Target Price: $${analysis.targetPrice.toFixed(2)}`));
    }
    if (analysis.stopLoss) {
      console.log(chalk.white(`Stop Loss: $${analysis.stopLoss.toFixed(2)}`));
    }
    console.log(chalk.cyan('================================\n'));
  }

  private getRecommendationEmoji(rec: string): string {
    switch (rec) {
      case 'STRONG_BUY': return '🚀';
      case 'BUY': return '📈';
      case 'HOLD': return '⏸️';
      case 'SELL': return '📉';
      case 'STRONG_SELL': return '💥';
      default: return '❓';
    }
  }

  private async executeAutoTrade(analysis: AnalysisResult): Promise<void> {
    if (analysis.confidence < 0.7) {
      console.log(chalk.yellow(`🤖 Auto-trade skipped: Low confidence (${(analysis.confidence * 100).toFixed(0)}%)`));
      return;
    }
    const action = analysis.recommendation;
    if (action === 'STRONG_BUY' || action === 'BUY') {
      console.log(chalk.green(`🤖 AUTO-TRADE: Executing BUY for ${analysis.pair.toUpperCase()}`));
      await this.onChainRecorder.executeTradeTransaction('BUY', analysis.pair, this.config.maxInvestmentPerTrade);
      console.log(chalk.green(`💰 Simulated purchase: $${this.config.maxInvestmentPerTrade} worth of ${analysis.pair.toUpperCase()}`));
    } else if (action === 'STRONG_SELL' || action === 'SELL') {
      console.log(chalk.red(`🤖 AUTO-TRADE: Executing SELL for ${analysis.pair.toUpperCase()}`));
      await this.onChainRecorder.executeTradeTransaction('SELL', analysis.pair, this.config.maxInvestmentPerTrade);
      console.log(chalk.red(`💰 Simulated sale of ${analysis.pair.toUpperCase()}`));
    } else {
      console.log(chalk.blue(`🤖 AUTO-TRADE: HOLDING ${analysis.pair.toUpperCase()}`));
    }
  }
  async showPortfolio(): Promise<void> {
    const balance = await this.supraClient.getAccountSupraCoinBalance(this.account.address());
    const balanceFormatted = (parseFloat(balance.toString()) / 1000000).toFixed(2);
    console.log(chalk.cyan.bold('\n💼 === PORTFOLIO STATUS ==='));
    console.log(chalk.white(`SUPRA Balance: ${balanceFormatted} SUPRA`));
    console.log(chalk.white(`Analysis History: ${this.analysisHistory.length} completed`));
    console.log(chalk.white(`Auto-Trading: ${this.config.enableAutoTrading ? '✅ ENABLED' : '❌ DISABLED'}`));
    console.log(chalk.white(`GPT Analysis: ${this.config.enableGPTAnalysis ? '✅ ENABLED' : '❌ DISABLED'}`));
    console.log(chalk.white(`On-Chain Recording: ${this.config.enableOnChainRecording ? '✅ ENABLED' : '❌ DISABLED'}`));
    if (this.analysisHistory.length > 0) {
      console.log(chalk.yellow('\n📈 === RECENT ANALYSES ==='));
      this.analysisHistory.slice(-3).forEach((analysis, index) => {
        console.log(chalk.white(`${index + 1}. ${analysis.pair.toUpperCase()}: ${analysis.recommendation} (${(analysis.confidence * 100).toFixed(0)}%)`));
      });
    }
    console.log(chalk.cyan('============================\n'));
  }

  toggleAutoTrading(): void {
    this.config.enableAutoTrading = !this.config.enableAutoTrading;
    const status = this.config.enableAutoTrading ? 'ENABLED' : 'DISABLED';
    const color = this.config.enableAutoTrading ? chalk.green : chalk.red;
    console.log(color(`🤖 Auto-trading ${status}`));
    if (this.config.enableAutoTrading) {
      console.log(chalk.yellow('⚠️ Auto-trading will execute trades based on AI analysis'));
      console.log(chalk.yellow(`💰 Max investment per trade: $${this.config.maxInvestmentPerTrade}`));
    }
  }

  showConfig(): void {
    console.log(chalk.blue('⚙️ === AGENT CONFIGURATION ==='));
    console.log(chalk.white(JSON.stringify(this.config, null, 2)));
    console.log(chalk.blue('===============================\n'));
  }
}
function parseIntelligentCommand(input: string): { command: string; args?: any } {
  const lower = input.toLowerCase().trim(); 
  if (lower.includes('analyze') || lower.includes('analysis')) {
    const symbols = ['btc', 'eth', 'supra', 'sol', 'ada', 'dot'];
    const symbol = symbols.find(s => lower.includes(s)) || 'btc';
    return { command: 'analyze', args: { symbol: `${symbol}_usdt` } };
  } else if (lower.includes('portfolio') || lower.includes('status')) {
    return { command: 'portfolio' };
  } else if (lower.includes('auto') && (lower.includes('trading') || lower.includes('trade'))) {
    return { command: 'toggle_auto' };
  } else if (lower.includes('config') || lower.includes('settings') || lower.includes('agent config')) {
    return { command: 'config' };
  } else if (lower.includes('balance')) {
    return { command: 'balance' };
  } else if (lower.includes('fund')) {
    return { command: 'fund' };
  } else if (lower.includes('help')) {
    return { command: 'help' };
  } else if (lower === 'exit' || lower === 'quit') {
    return { command: 'exit' };
  }  return { command: 'unknown' };
}
async function loadOrCreateAccount(): Promise<SupraAccount> {
  const accountFilePath = path.join(__dirname, 'account.json'); 
  if (fs.existsSync(accountFilePath)) {
    try {
      const data = fs.readFileSync(accountFilePath, 'utf-8');
      const accountObj = JSON.parse(data);
      const account = SupraAccount.fromSupraAccountObject(accountObj);
      console.log(chalk.green("✅ Loaded existing account from account.json"));
      return account;
    } catch (error) {
      console.error(chalk.red("Error reading account file, creating new account"), error);
    }
  }
  const account = new SupraAccount();
  const accountObj = account.toPrivateKeyObject();
  fs.writeFileSync(accountFilePath, JSON.stringify(accountObj, null, 2));
  console.log(chalk.yellow("✅ Created new account and saved to account.json"));
  return account;
}
async function main() {
  console.log(chalk.cyan.bold('\n🚀 === SUPRA GPT-POWERED ORACLE ANALYSIS AGENT ===\n'));
  console.log(chalk.blue('Initializing Supra Client...'));
  const supraClient = await SupraClient.init('https://rpc-testnet.supra.com');
  console.log(chalk.green('✅ Connected to Supra testnet'));
  const account = await loadOrCreateAccount();
  console.log(chalk.green(`🔑 Account: ${account.address().toString()}`));
  const SUPRA_API_KEY = process.env.SUPRA_ORACLE_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!SUPRA_API_KEY) {
    console.log(chalk.red('❌ SUPRA_ORACLE_API_KEY not found'));
    console.log(chalk.yellow('💡 Set it with: export SUPRA_ORACLE_API_KEY="your_key"'));
    process.exit(1);
  }  if (!OPENAI_API_KEY) {
    console.log(chalk.yellow('⚠️ OPENAI_API_KEY not found - GPT analysis disabled'));
    console.log(chalk.yellow('💡 Set it with: export OPENAI_API_KEY="your_openai_key"'));
  }
    const agent = new IntelligentTradingAgent(supraClient, account, SUPRA_API_KEY, OPENAI_API_KEY);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.magenta('🤖 Command to Agent> ')
  });
  
  console.log(chalk.yellow('\n🎯 === COMMANDS ==='));
  console.log('  "analyze BTC/ETH/SUPRA"       - Get AI-powered market analysis + record on-chain');
  console.log('  "show portfolio"              - View account status and analysis history');
  console.log('  "enable/disable auto trading" - Toggle automated trading based on AI signals');
  console.log('  "show agent configs"          - View agent configuration settings');
  console.log('  "check balance"               - View SUPRA balance');
  console.log('  "fund account"                - Request testnet funds from faucet');
  console.log('  "help"                        - Show this command menu');
  console.log('  "exit"                        - Quit agent\n');
  
  rl.prompt();
  rl.on('line', async (input: string) => {
    const { command, args } = parseIntelligentCommand(input);
    switch (command) {
      case 'analyze':
        await agent.analyzeToken(args.symbol);
        break;
      case 'portfolio':
        await agent.showPortfolio();
        break;        
      case 'toggle_auto':
        agent.toggleAutoTrading();
        break;
      case 'config':
        agent.showConfig();
        break;        
      case 'balance':
        try {
          const balance = await supraClient.getAccountSupraCoinBalance(account.address());
          const formatted = (parseFloat(balance.toString()) / 1000000).toFixed(2);
          console.log(chalk.cyan(`💰 Account Balance: ${formatted} SUPRA`));
        } catch (error) {
          console.error(chalk.red('❌ Error fetching balance'));
        }        break;
      case 'fund':
        try {
          console.log(chalk.blue('💸 Requesting testnet funds...'));
          await supraClient.fundAccountWithFaucet(account.address());
          console.log(chalk.green('✅ Funding request submitted - check balance in 30 seconds'));
        } catch (error) {
          console.error(chalk.red('❌ Funding failed'));
        }        break;
      case 'help':
        console.log(chalk.yellow('\n🎯 === COMMANDS ==='));
        console.log('  "analyze BTC/ETH/SUPRA"       - Get AI-powered market analysis + record on-chain');
        console.log('  "show portfolio"              - View account status and analysis history');
        console.log('  "enable/disable auto trading" - Toggle automated trading based on AI signals');
        console.log('  "show agent configs"          - View agent configuration settings');
        console.log('  "check balance"               - View SUPRA balance');
        console.log('  "fund account"                - Request testnet funds from faucet');
        console.log('  "exit"                        - Quit agent\n');
        break;
      case 'exit':
        console.log(chalk.blue('👋 Shutting down GPT Analysis Agent...'));
        rl.close();
        process.exit(0);
      default:
        console.log(chalk.red('❓ Command not recognized. Type "help" for available commands.'));
    }    rl.prompt();
  });
  rl.on('close', () => {
    console.log(chalk.blue('🔌 GPT Analysis Agent disconnected.'));
  });
}
main().catch((error) => {
  console.error(chalk.red('❌ Agent initialization error:'), error);
});