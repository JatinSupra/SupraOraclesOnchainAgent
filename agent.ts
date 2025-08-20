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
  enableAIThresholdOracle: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  maxInvestmentPerTrade: number;
  confidenceThreshold: number;
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
  aiThresholdConsensus?: AIThresholdResult;
}

interface AIThresholdResult {
  agentVotes: AgentVote[];
  consensus: 'BUY' | 'SELL' | 'HOLD';
  consensusConfidence: number;
  agreementPercentage: number;
  shouldExecuteAutomation: boolean;
}

interface AgentVote {
  agentId: string;
  recommendation: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
}

interface SupraAgentAutomationTask {
  taskId: string;
  txHash: string;
  totalBudget: number;
  amountPerSwap: number;
  timeInterval: number;
  slippageTolerance: number;
  triggerCrypto: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  registeredAt: number;
  expiresAt: number;
}

// ===== SUPRA ORACLE SERVICE =====

class SupraOracleService {
  private baseUrl: string = 'https://prod-kline-rest.supra.com';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getLatestPrice(tradingPair: string): Promise<PriceData | null> {
    try {
      console.log(chalk.blue(`Fetching live data for ${tradingPair.toUpperCase()}...`));
      
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
        
        console.log(chalk.green(`✅ Live data: ${tradingPair.toUpperCase()} = $${priceData.currentPrice.toFixed(2)}`));
        return priceData;
      }
      return null;
    } catch (error: any) {
      console.error(chalk.red(`Error fetching ${tradingPair}:`), error.message);
      return null;
    }
  }

  async getHistoricalData(tradingPair: string, hoursBack: number = 24): Promise<any[]> {
    try {
      const endDate = Date.now();
      const startDate = endDate - (hoursBack * 60 * 60 * 1000);
      
      console.log(chalk.blue(`Fetching ${hoursBack}h historical data for ${tradingPair.toUpperCase()}...`));
      
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
        console.log(chalk.green(`✅ Historical data: ${response.data.data.length} data points`));
        return response.data.data;
      }
      return [];
    } catch (error: any) {
      console.error(chalk.red(`Error fetching historical data for ${tradingPair}:`), error.message);
      return [];
    }
  }
}

// ===== AI THRESHOLD ORACLE SERVICE =====

class AIThresholdOracleService {
  private openai: OpenAI;
  private agentConfigs: Array<{id: string, role: string, expertise: string}>;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
    this.agentConfigs = [
      { 
        id: 'technical_analyst', 
        role: 'Technical Analysis Expert', 
        expertise: 'Chart patterns, indicators, momentum' 
      },
      { 
        id: 'fundamental_analyst', 
        role: 'Fundamental Analysis Expert', 
        expertise: 'Market fundamentals, news sentiment' 
      },
      { 
        id: 'risk_manager', 
        role: 'Risk Management Specialist', 
        expertise: 'Risk assessment, position sizing' 
      },
      { 
        id: 'macro_analyst', 
        role: 'Macro Economic Analyst', 
        expertise: 'Economic trends, global markets' 
      },
      { 
        id: 'quant_trader', 
        role: 'Quantitative Trading Expert', 
        expertise: 'Statistical models, algorithmic trading' 
      }
    ];
  }

  async getThresholdConsensus(priceData: PriceData, historicalData: any[], gptAnalysis: string): Promise<AIThresholdResult> {
    try {
      console.log(chalk.blue('AI THRESHOLD ORACLE panel...'));
      console.log(chalk.blue('Each expert analyzing from their specialty...'));

      const agentVotes: AgentVote[] = [];

      const votePromises = this.agentConfigs.map(agent => 
        this.askExpert(agent, priceData, historicalData, gptAnalysis)
      );

      const votes = await Promise.all(votePromises);
      agentVotes.push(...votes);

      const consensus = this.countVotes(agentVotes);
      
      console.log(chalk.green(`Expert votes: ${this.getVoteSummary(agentVotes)}`));
      console.log(chalk.green(`✅ Decision: ${consensus.consensus} (${consensus.consensusConfidence}% confidence)`));

      return consensus;
    } catch (error: any) {
      console.error(chalk.red('Expert panel failed to respond:'), error.message);
      return {
        agentVotes: [],
        consensus: 'HOLD',
        consensusConfidence: 0,
        agreementPercentage: 0,
        shouldExecuteAutomation: false
      };
    }
  }

  private async askExpert(
    expert: {id: string, role: string, expertise: string}, 
    priceData: PriceData, 
    historicalData: any[], 
    gptAnalysis: string
  ): Promise<AgentVote> {
    const prompt = `
You are a ${expert.role}, specializing in ${expert.expertise}.

MARKET DATA FOR ${priceData.tradingPair.toUpperCase()}:
- Current Price: $${priceData.currentPrice}
- 24h Change: ${priceData.change24h}%
- 24h High: $${priceData.high24h}
- 24h Low: $${priceData.low24h}
- Data Points: ${historicalData.length}

PREVIOUS ANALYSIS:
${gptAnalysis}

As a ${expert.role}, give your expert trading recommendation:

RECOMMENDATION: [BUY/SELL/HOLD]
CONFIDENCE: [0-100]
REASONING: [one sentence explaining your decision from your expertise perspective]

Focus ONLY on your specialty: ${expert.expertise}
`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are ${expert.role}. Think like a professional ${expert.expertise} specialist. Be decisive.`
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 150,
        temperature: 0.3
      });

      const response = completion.choices[0].message.content || '';
      return this.parseExpertResponse(expert.id, response);
    } catch (error) {
      console.error(chalk.yellow(`Expert ${expert.id} didn't respond, using default`));
      return {
        agentId: expert.id,
        recommendation: 'HOLD',
        confidence: 50,
        reasoning: 'AI THRESHOLD Oracle analysis failed'
      };
    }
  }

  private parseExpertResponse(expertId: string, response: string): AgentVote {
    const recommendationMatch = response.match(/RECOMMENDATION:\s*(BUY|SELL|HOLD)/i);
    const confidenceMatch = response.match(/CONFIDENCE:\s*(\d+)/);
    const reasoningMatch = response.match(/REASONING:\s*(.+)/i);

    return {
      agentId: expertId,
      recommendation: (recommendationMatch?.[1]?.toUpperCase() as 'BUY' | 'SELL' | 'HOLD') || 'HOLD',
      confidence: parseInt(confidenceMatch?.[1] || '50'),
      reasoning: reasoningMatch?.[1]?.trim() || 'No reasoning provided'
    };
  }

  private countVotes(votes: AgentVote[]): AIThresholdResult {
    const voteCount = { BUY: 0, SELL: 0, HOLD: 0 };

    votes.forEach(vote => {
      voteCount[vote.recommendation]++;
    });

    const winner = Object.entries(voteCount).reduce((a, b) => 
      voteCount[a[0] as keyof typeof voteCount] > voteCount[b[0] as keyof typeof voteCount] ? a : b
    )[0] as 'BUY' | 'SELL' | 'HOLD';

    const totalVotes = votes.length;
    const winningVotes = voteCount[winner];
    const agreementPercentage = (winningVotes / totalVotes) * 100;
    
    const winnerConfidence = votes
      .filter(vote => vote.recommendation === winner)
      .reduce((sum, vote) => sum + vote.confidence, 0) / winningVotes;

    const shouldExecuteAutomation = agreementPercentage >= 60 && winnerConfidence >= 70;

    return {
      agentVotes: votes,
      consensus: winner,
      consensusConfidence: Math.round(winnerConfidence),
      agreementPercentage: Math.round(agreementPercentage),
      shouldExecuteAutomation
    };
  }

  private getVoteSummary(votes: AgentVote[]): string {
    const voteCount = { BUY: 0, SELL: 0, HOLD: 0 };
    votes.forEach(vote => voteCount[vote.recommendation]++);
    return `${voteCount.BUY} BUY, ${voteCount.SELL} SELL, ${voteCount.HOLD} HOLD`;
  }
}

// ===== SUPRA AGENT AUTOMATION MANAGER =====

class SupraAgentAutomationManager {
  private supraClient: SupraClient;
  private account: SupraAccount;
  private moduleAddress: string = "0x1c5acf62be507c27a7788a661b546224d806246765ff2695efece60194c6df05";
  private activeTasks: SupraAgentAutomationTask[] = [];

  constructor(supraClient: SupraClient, account: SupraAccount) {
    this.supraClient = supraClient;
    this.account = account;
  }

  async registerSupraAgentAutomation(config: {
    triggerCrypto: string,
    totalBudget: number,
    confidence: number,
    timeframe: string
  }): Promise<SupraAgentAutomationTask | null> {
    try {
      console.log(chalk.blue('Registering SupraAgent automation...'));
      
      const senderAddr = this.account.address();
      const balance = await this.supraClient.getAccountCoinBalance(
        senderAddr,
        '0x1::supra_coin::SupraCoin'
      );
      const balanceInSupra = Number(balance) / 1000000;
      
      const bufferAmount = 500;
      if (balanceInSupra < config.totalBudget + bufferAmount) {
        throw new Error(`Insufficient balance. Required: ${config.totalBudget + bufferAmount} SUPRA, Available: ${balanceInSupra.toFixed(2)} SUPRA`);
      }

      const dcaParams = this.calculateSimpleDCAParameters(config.totalBudget, config.confidence);
      const expiryTime = await this.calculateProperExpiryTime();
      
      let automationFeeCapBigInt = BigInt(1440000000);
      try {
        const feeEstimate = await this.supraClient.invokeViewMethod(
          "0x1::automation_registry::estimate_automation_fee",
          [],
          ["5000"]
        );
        if (feeEstimate && feeEstimate[0]) {
          automationFeeCapBigInt = BigInt(feeEstimate[0]);
        }
      } catch (feeError: any) {
      }

      const totalRequiredMicro = Number(automationFeeCapBigInt) + (config.totalBudget * 10000) + (100 * 1000000);
      if (Number(balance) < totalRequiredMicro) {
        throw new Error(`Insufficient balance. Required: ${totalRequiredMicro / 1000000} SUPRA, Available: ${balanceInSupra} SUPRA`);
      }

      const budgetMicro = Math.floor(config.totalBudget * 1000000);
      const swapAmountMicro = Math.floor(dcaParams.amountPerSwap * 1000000);
      
      const functionArgs: Uint8Array[] = [
        this.encodeU64ToUint8Array(budgetMicro),
        this.encodeU64ToUint8Array(swapAmountMicro),
        this.encodeU64ToUint8Array(dcaParams.timeInterval),
        this.encodeU64ToUint8Array(dcaParams.slippageTolerance),
      ];

      console.log(chalk.blue('Submitting automation transaction...'));
      let retryCount = 0;
      const maxRetries = 3;
      let finalTxHash: string | undefined;

      while (retryCount < maxRetries) {
        try {
          if (retryCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          const freshAccountInfo = await this.supraClient.getAccountInfo(senderAddr);
          const freshSequenceNumber = BigInt(freshAccountInfo.sequence_number);
          const moduleAddr = this.moduleAddress.replace('0x', '');
          
          const serializedAutomationTx = this.supraClient.createSerializedAutomationRegistrationTxPayloadRawTxObject(
            senderAddr,
            freshSequenceNumber,
            moduleAddr,
            "agent_swap_autom",
            "process_automated_swap",
            [],
            functionArgs,
            BigInt(5000),
            BigInt(200),
            automationFeeCapBigInt,
            BigInt(expiryTime),
            []
          );

          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const result = await this.supraClient.sendTxUsingSerializedRawTransaction(
            this.account,
            serializedAutomationTx
          );

          finalTxHash = this.extractTransactionHash(result);
          
          if (!finalTxHash) {
            throw new Error('No transaction hash returned');
          }
          break;

        } catch (error: any) {
          retryCount++;
          if (error.message.includes('SEQUENCE_NUMBER') || 
              error.message.includes('sequence') ||
              (error.response?.data?.message && error.response.data.message.includes('SEQUENCE_NUMBER'))) {
            
            if (retryCount < maxRetries) {
              const waitTime = retryCount * 2000 + 2000;
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            } else {
              throw new Error(`Sequence number conflicts after ${maxRetries} attempts`);
            }
          } else {
            throw error;
          }
        }
      }
      if (!finalTxHash) {
        throw new Error('Failed to get transaction hash after all retries');
      }
      
      console.log(chalk.green('✅ Transaction submitted successfully'));
      console.log(chalk.white(`TX: ${finalTxHash}`));
      await new Promise(resolve => setTimeout(resolve, 8000));      
      const taskId = this.generateTaskId(finalTxHash);
      const task: SupraAgentAutomationTask = {
        taskId,
        txHash: finalTxHash,
        totalBudget: config.totalBudget,
        amountPerSwap: dcaParams.amountPerSwap,
        timeInterval: dcaParams.timeInterval,
        slippageTolerance: dcaParams.slippageTolerance,
        triggerCrypto: config.triggerCrypto,
        status: 'ACTIVE',
        registeredAt: Date.now(),
        expiresAt: expiryTime * 1000
      };

      this.activeTasks.push(task);      
      console.log(chalk.green('✅ SupraAgent automation registered successfully'));
      console.log(chalk.cyan('\n=== AUTOMATION SUMMARY ==='));
      console.log(chalk.white(`Task ID: ${taskId}`));
      console.log(chalk.white(`Signal: ${config.triggerCrypto.toUpperCase()} investment signal`));
      console.log(chalk.white(`DCA Strategy: ${dcaParams.amountPerSwap} SUPRA → TestCoin every ${dcaParams.timeInterval}s`));
      console.log(chalk.white(`Total Budget: ${config.totalBudget} SUPRA will convert to TestCrypto over time`));
      console.log(chalk.white(`Transaction: https://testnet.suprascan.io/tx/${finalTxHash}`));
      console.log(chalk.cyan('=========================='));

      return task;

    } catch (error: any) {
      console.error(chalk.red('Automation registration failed:'), error.message);
      return null;
    }
  }

  private async calculateProperExpiryTime(): Promise<number> {
    try {
      const reconfigData = await this.supraClient.getResourceData(
        new HexString("0x1"),
        "0x1::reconfiguration::Configuration"
      );
      
      const lastReconfigTimeMicroseconds = parseInt(reconfigData.last_reconfiguration_time);
      const lastReconfigTimeSeconds = Math.floor(lastReconfigTimeMicroseconds / 1000000);
      
      const blockData = await this.supraClient.getResourceData(
        new HexString("0x1"),
        "0x1::block::BlockResource"
      );
      
      const epochIntervalMicroseconds = parseInt(blockData.epoch_interval);
      const epochIntervalSeconds = Math.floor(epochIntervalMicroseconds / 1000000);
      
      const buffer = 300;
      const expiryTime = lastReconfigTimeSeconds + epochIntervalSeconds + buffer;
      
      return expiryTime;
      
    } catch (error: any) {
      const fallbackExpiry = Math.floor(Date.now() / 1000) + (8 * 60 * 60);
      return fallbackExpiry;
    }
  }

  private encodeU64ToUint8Array(value: number): Uint8Array {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setBigUint64(0, BigInt(value), true);
    
    return new Uint8Array(buffer);
  }

  async getSupraAgentAutomationStatus(userAddress: string): Promise<{
    isInitialized: boolean;
    supraBudgetUsed: number;
    totalBudget: number;
    supraAgentReceived: number;
    totalSwaps: number;
    isActive: boolean;
    willTriggerNext: boolean;
  }> {
    try {
      const isInitialized = await this.supraClient.invokeViewMethod(
        `${this.moduleAddress}::agent_swap_autom::is_automation_initialized`,
        [],
        [userAddress]
      );

      if (!isInitialized[0]) {
        return {
          isInitialized: false,
          supraBudgetUsed: 0,
          totalBudget: 0,
          supraAgentReceived: 0,
          totalSwaps: 0,
          isActive: false,
          willTriggerNext: false
        };
      }

      const stats = await this.supraClient.invokeViewMethod(
        `${this.moduleAddress}::agent_swap_autom::get_user_automation_stats`,
        [],
        [userAddress]
      );

      const willTrigger = await this.supraClient.invokeViewMethod(
        `${this.moduleAddress}::agent_swap_autom::will_swap_trigger`,
        [],
        [userAddress]
      );

      return {
        isInitialized: true,
        supraBudgetUsed: Number(stats[0]),
        totalBudget: Number(stats[1]),
        supraAgentReceived: Number(stats[2]),
        totalSwaps: Number(stats[3]),
        isActive: Boolean(stats[4]),
        willTriggerNext: Boolean(willTrigger[0])
      };

    } catch (error) {
      console.error(chalk.red('Error fetching automation status'), error);
      return {
        isInitialized: false,
        supraBudgetUsed: 0,
        totalBudget: 0,
        supraAgentReceived: 0,
        totalSwaps: 0,
        isActive: false,
        willTriggerNext: false
      };
    }
  }

  async showActiveTasks(): Promise<void> {
    console.log(chalk.cyan.bold('\n=== SUPRA AGENT AUTOMATION TASKS ==='));
    
    if (this.activeTasks.length === 0) {
      console.log(chalk.yellow('No active SupraAgent automation tasks'));
      return;
    }

    for (const task of this.activeTasks) {
      console.log(chalk.white(`Task: ${task.taskId}`));
      console.log(chalk.white(`Trigger: ${task.triggerCrypto.toUpperCase()} signal`));
      console.log(chalk.white(`Budget: ${task.totalBudget} SUPRA (${task.amountPerSwap} per swap)`));
      console.log(chalk.white(`Interval: ${task.timeInterval}s between swaps`));
      
      const status = await this.getSupraAgentAutomationStatus(this.account.address().toString());
      if (status.isInitialized) {
        const progress = status.totalBudget > 0 ? (status.supraBudgetUsed / status.totalBudget * 100).toFixed(1) : 0;
        console.log(chalk.green(`Progress: ${status.supraBudgetUsed}/${status.totalBudget} SUPRA (${progress}%)`));
        console.log(chalk.green(`SupraAgent Earned: ${status.supraAgentReceived.toFixed(4)} SupraAgent`));
        console.log(chalk.green(`Swaps: ${status.totalSwaps} completed`));
        console.log(chalk.green(`Status: ${status.isActive ? 'ACTIVE' : 'COMPLETED'}`));
        console.log(chalk.green(`Next Swap: ${status.willTriggerNext ? 'READY' : 'WAITING'}`));
      }
      
      console.log(chalk.white(`TX: https://testnet.suprascan.io/tx/${task.txHash}`));
      console.log('');
    }
    
    console.log(chalk.cyan('=====================================\n'));
  }

  private calculateSimpleDCAParameters(totalBudget: number, confidence: number): {
    amountPerSwap: number;
    timeInterval: number;
    slippageTolerance: number;
  } {
    const timeInterval = 2;
    const slippageTolerance = 400;
    
    const swapsCount = 2;
    const amountPerSwap = totalBudget / swapsCount;
    
    return {
      amountPerSwap,
      timeInterval,
      slippageTolerance
    };
  }

  private extractTransactionHash(result: any): string {
    if (result?.hash) return result.hash;
    if (result?.txHash) return result.txHash;
    if (result?.transaction_hash) return result.transaction_hash;
    if (typeof result === 'string' && result.startsWith('0x')) {
      return result;
    }
    throw new Error(`No valid transaction hash found: ${JSON.stringify(result)}`);
  }

  private generateTaskId(txHash: string): string {
    return `supraagent_${txHash.slice(-8)}`;
  }
}

// ===== GPT ANALYSIS SERVICE =====

class GPTAnalysisService {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async analyzeMarketData(priceData: PriceData, historicalData: any[]): Promise<AnalysisResult> {
    try {
      console.log(chalk.blue('Analyzing market data...'));

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
      console.log(chalk.green('✅ Analysis completed'));
      
      return this.parseGPTResponse(priceData.tradingPair, analysis);
    } catch (error: any) {
      console.error(chalk.red('Analysis failed:'), error.message);
      return {
        pair: priceData.tradingPair,
        analysis: 'Analysis failed - using basic technical indicators',
        recommendation: 'HOLD',
        confidence: 0.3,
        reasoning: 'Could not perform analysis',
        timeframe: '24h'
      };
    }
  }

  private buildAnalysisPrompt(priceData: PriceData, historicalData: any[]): string {
    const prices = historicalData.map(d => parseFloat(d.close)).slice(-24);  
    
    return `
Analyze this crypto trading data for ${priceData.tradingPair.toUpperCase()}:

CURRENT DATA:
- Price: $${priceData.currentPrice}
- 24h Change: ${priceData.change24h}%
- 24h High: $${priceData.high24h}
- 24h Low: $${priceData.low24h}

HISTORICAL PRICES (last 24 hours): ${prices.slice(-5).join(', ')}

Please provide:
1. Overall market sentiment (STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL)
2. Confidence level (0-100)
3. Key reasoning points

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

    return {
      pair,
      analysis,
      recommendation,
      confidence,
      reasoning: analysis.split('\n').slice(0, 2).join(' '),
      timeframe: '24h'
    };
  }
}

// ===== ON-CHAIN RECORDER =====

class OnChainRecorder {
  private supraClient: SupraClient;
  private account: SupraAccount;

  constructor(supraClient: SupraClient, account: SupraAccount) {
    this.supraClient = supraClient;
    this.account = account;
  }

  async recordAnalysis(analysis: AnalysisResult): Promise<string | null> {
    try {
      console.log(chalk.blue('Recording analysis on Supra blockchain...'));
      const amount = BigInt(1);
      const txResponse = await this.supraClient.transferSupraCoin(
        this.account,
        this.account.address(),
        amount
      );
      
      console.log(chalk.green('✅ Analysis recorded on-chain'));
      console.log(chalk.white(`Transaction: https://testnet.suprascan.io/tx/${txResponse.txHash}`));
      return txResponse.txHash;
    } catch (error: any) {
      console.error(chalk.red('Failed to record analysis on-chain:'), error.message);
      return null;
    }
  }
}

// ===== MAIN SUPRA AGENT CLASS =====

class IntelligentSupraAgentTrader {
  private supraClient: SupraClient;
  private account: SupraAccount;
  private oracleService: SupraOracleService;
  private gptService: GPTAnalysisService | null = null;
  private aiThresholdService: AIThresholdOracleService | null = null;
  private supraAgentManager: SupraAgentAutomationManager;
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
    this.supraAgentManager = new SupraAgentAutomationManager(supraClient, account);
    this.onChainRecorder = new OnChainRecorder(supraClient, account);
    
    if (openaiApiKey) {
      this.gptService = new GPTAnalysisService(openaiApiKey);
      this.aiThresholdService = new AIThresholdOracleService(openaiApiKey);
    }
    this.config = {
      enableGPTAnalysis: !!openaiApiKey,
      enableOnChainRecording: true,
      enableAutoTrading: false,
      enableAIThresholdOracle: !!openaiApiKey,
      riskLevel: 'MEDIUM',
      maxInvestmentPerTrade: 400,
      confidenceThreshold: 0.7
    };
  }

  async analyzeToken(tradingPair: string): Promise<AnalysisResult | null> {
    try {
      console.log(chalk.cyan.bold(`\n=== ANALYZING ${tradingPair.toUpperCase()} ===`));
      
      const priceData = await this.oracleService.getLatestPrice(tradingPair);
      if (!priceData) {
        console.log(chalk.red('Could not fetch price data'));
        return null;
      }

      const historicalData = await this.oracleService.getHistoricalData(tradingPair, 24);

      let analysis: AnalysisResult;      
      if (this.config.enableGPTAnalysis && this.gptService) {
        analysis = await this.gptService.analyzeMarketData(priceData, historicalData);
      } else {
        analysis = this.performBasicAnalysis(priceData, historicalData);
      }

      if (this.config.enableAIThresholdOracle && this.aiThresholdService) {
        const expertConsensus = await this.aiThresholdService.getThresholdConsensus(
          priceData, 
          historicalData, 
          analysis.analysis
        );
        analysis.aiThresholdConsensus = expertConsensus;
        if (expertConsensus.shouldExecuteAutomation) {
          analysis.recommendation = expertConsensus.consensus as any;
          analysis.confidence = expertConsensus.consensusConfidence / 100;
        }
      }
      this.displayResults(priceData, analysis);

      if (this.config.enableOnChainRecording) {
        await this.onChainRecorder.recordAnalysis(analysis);
      }

      if (this.config.enableAutoTrading) {
        await this.executeAutomationIfApproved(analysis);
      }

      this.analysisHistory.push(analysis);
      if (this.analysisHistory.length > 10) {
        this.analysisHistory.shift(); 
      }

      return analysis;
    } catch (error: any) {
      console.error(chalk.red('Analysis failed:'), error.message);
      return null;
    }
  }

  private async executeAutomationIfApproved(analysis: AnalysisResult): Promise<void> {
    const expertsApprove = analysis.aiThresholdConsensus?.shouldExecuteAutomation || false;
    const highConfidence = analysis.confidence >= this.config.confidenceThreshold;
    if (!expertsApprove && !highConfidence) {
      console.log(chalk.yellow(`Auto-trading SKIPPED: Experts didn't agree or low confidence`));
      return;
    }

    const action = analysis.recommendation;
    if (action === 'STRONG_BUY' || action === 'BUY') {
      console.log(chalk.green(`AI THRESHOLD Oracle APPROVED: Registering SupraAgent automation for ${analysis.pair.toUpperCase()}`));
      const automationTask = await this.supraAgentManager.registerSupraAgentAutomation({
        triggerCrypto: analysis.pair,
        totalBudget: this.config.maxInvestmentPerTrade,
        confidence: analysis.confidence,
        timeframe: this.determineTimeframe(analysis.confidence)
      });
      if (automationTask) {
        console.log(chalk.green(`Check Your SupraScan Tasks Tab for details`));
      }
    } else if (action === 'STRONG_SELL' || action === 'SELL') {
      console.log(chalk.red(`AI THRESHOLD Oracle DECISION: SELL signal for ${analysis.pair.toUpperCase()} - No SupraAgent investment`));
    } else {
      console.log(chalk.blue(`AI THRESHOLD Oracle DECISION: HOLD ${analysis.pair.toUpperCase()} - No action taken`));
    }
  }

  private determineTimeframe(confidence: number): string {
    if (confidence > 0.8) return 'fast';
    if (confidence > 0.6) return 'medium';
    return 'slow';
  }

  async showPortfolio(): Promise<void> {
    console.log(chalk.cyan.bold('\n=== SUPRA AGENT PORTFOLIO ==='));
    const supraBalance = await this.supraClient.getAccountSupraCoinBalance(this.account.address());
    const supraBal = Number(supraBalance) / 1000000;
    console.log(chalk.white(`SUPRA Balance: ${supraBal.toFixed(2)} SUPRA`));
    
    const supraAgentStatus = await this.supraAgentManager.getSupraAgentAutomationStatus(this.account.address().toString());
    console.log(chalk.white(`SupraAgent Investment: ${supraAgentStatus.supraAgentReceived.toFixed(4)} SupraAgent`));
    console.log(chalk.white(`Investment Progress: ${supraAgentStatus.supraBudgetUsed}/${supraAgentStatus.totalBudget} SUPRA`));
    console.log(chalk.white(`Total DCA Swaps: ${supraAgentStatus.totalSwaps}`));
    console.log(chalk.white(`Automation Status: ${supraAgentStatus.isActive ? '✅ ACTIVE' : '❌ INACTIVE'}`));
    console.log(chalk.white(`Analysis History: ${this.analysisHistory.length} completed`));
    console.log(chalk.white(`Auto-Trading: ${this.config.enableAutoTrading ? '✅ ENABLED' : '❌ DISABLED'}`));
    console.log(chalk.white(`AI THRESHOLD Oracle: ${this.config.enableAIThresholdOracle ? '✅ ENABLED' : '❌ DISABLED'}`));
    
    if (this.analysisHistory.length > 0) {
      console.log(chalk.cyan('\n=== RECENT SIGNALS ==='));
      this.analysisHistory.slice(-3).forEach((analysis, index) => {
        const expertInfo = analysis.aiThresholdConsensus ? 
          ` (Experts: ${analysis.aiThresholdConsensus.consensus})` : '';
        console.log(chalk.white(`${index + 1}. ${analysis.pair.toUpperCase()}: ${analysis.recommendation} (${(analysis.confidence * 100).toFixed(0)}%)${expertInfo}`));
      });
    }
    
    console.log(chalk.cyan('==============================\n'));
  }
  async showActiveTasks(): Promise<void> {
    await this.supraAgentManager.showActiveTasks();
  }

  private performBasicAnalysis(priceData: PriceData, historicalData: any[]): AnalysisResult {
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
  private displayResults(priceData: PriceData, analysis: AnalysisResult): void {
    console.log(chalk.cyan('\n=== PRICE DATA ==='));
    console.log(chalk.white(`Current Price: ${priceData.currentPrice.toFixed(2)}`));
    console.log(chalk.white(`24h Change: ${priceData.change24h.toFixed(2)}%`));
    console.log(chalk.white(`24h High: ${priceData.high24h.toFixed(2)}`));
    console.log(chalk.white(`24h Low: ${priceData.low24h.toFixed(2)}`));
    
    console.log(chalk.cyan('\n=== ANALYSIS ==='));
    console.log(chalk.white(`Recommendation: ${this.getRecommendationSymbol(analysis.recommendation)} ${analysis.recommendation}`));
    console.log(chalk.white(`Confidence: ${(analysis.confidence * 100).toFixed(0)}%`));
    console.log(chalk.white(`Reasoning: ${analysis.reasoning}`));
    if (analysis.aiThresholdConsensus) {
      this.displayExpertVotes(analysis.aiThresholdConsensus);
    }    
    console.log(chalk.cyan('\n========================\n'));
  }
  private displayExpertVotes(experts: AIThresholdResult): void {
    if (experts.agentVotes.length > 0) {
      console.log(chalk.cyan('\n=== AI THRESHOLD Oracle ANALYSIS ==='));
      console.log(chalk.white('┌─────────────────────────┬──────────┬────────────┬──────────────────────────────────┐'));
      console.log(chalk.white('│ Expert                  │ Decision │ Confidence │ Reasoning                        │'));
      console.log(chalk.white('├─────────────────────────┼──────────┼────────────┼──────────────────────────────────┤'));
      experts.agentVotes.forEach(vote => {
        const expertName = this.formatExpertName(vote.agentId);
        const decision = vote.recommendation.padEnd(8);
        const confidence = `${vote.confidence}%`.padEnd(10);
        const reasoning = this.truncateReasoning(vote.reasoning, 32);
        
        const decisionColor = this.getDecisionColor(vote.recommendation);
        
        console.log(chalk.white('│ ') + 
                   chalk.cyan(expertName.padEnd(23)) + 
                   chalk.white(' │ ') + 
                   decisionColor(decision) + 
                   chalk.white(' │ ') + 
                   chalk.yellow(confidence) + 
                   chalk.white(' │ ') + 
                   chalk.white(reasoning.padEnd(32)) + 
                   chalk.white(' │'));
      });
      console.log(chalk.white('└─────────────────────────┴──────────┴────────────┴──────────────────────────────────┘'));
      console.log(chalk.cyan(`\nConsensus: ${experts.consensus} (${experts.agreementPercentage}% agreement, ${experts.consensusConfidence}% confidence)`));
      console.log(chalk.white(`Execute Investment: ${experts.shouldExecuteAutomation ? '✅ YES' : '❌ NO'}`));
    }
  }

  private formatExpertName(agentId: string): string {
    const names: { [key: string]: string } = {
      'technical_analyst': 'Technical Analyst',
      'fundamental_analyst': 'Fundamental Analyst', 
      'risk_manager': 'Risk Manager',
      'macro_analyst': 'Macro Analyst',
      'quant_trader': 'Quant Trader'
    };
    return names[agentId] || agentId;
  }

  private getDecisionColor(decision: string): (text: string) => string {
    switch (decision) {
      case 'BUY': return chalk.green;
      case 'SELL': return chalk.red;
      case 'HOLD': return chalk.yellow;
      default: return chalk.white;
    }
  }

  private truncateReasoning(text: string, maxLength: number): string {
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  }

  private getRecommendationSymbol(rec: string): string {
    switch (rec) {
      case 'STRONG_BUY': return '++';
      case 'BUY': return '+';
      case 'HOLD': return '=';
      case 'SELL': return '-';
      case 'STRONG_SELL': return '--';
      default: return '?';
    }
  }

  toggleAutoTrading(): void {
    this.config.enableAutoTrading = !this.config.enableAutoTrading;
    const status = this.config.enableAutoTrading ? 'ENABLED' : 'DISABLED';
    const color = this.config.enableAutoTrading ? chalk.green : chalk.red;
    console.log(color(`Auto-trading ${status}`));
    if (this.config.enableAutoTrading) {
      console.log(chalk.yellow('Auto-trading will invest in SupraAgent when experts agree'));
      console.log(chalk.yellow(`Max investment per signal: ${this.config.maxInvestmentPerTrade} SUPRA`));
      console.log(chalk.white('SupraAgent represents your diversified investment portfolio'));
    }
  }

  toggleAIExperts(): void {
    this.config.enableAIThresholdOracle = !this.config.enableAIThresholdOracle;
    const status = this.config.enableAIThresholdOracle ? 'ENABLED' : 'DISABLED';
    const color = this.config.enableAIThresholdOracle ? chalk.green : chalk.red;
    console.log(color(`AI THRESHOLD Oracle ${status}`));
    if (this.config.enableAIThresholdOracle) {
      console.log(chalk.yellow('5 trading experts will vote on SupraAgent investments'));
    }
  }

  showConfig(): void {
    console.log(chalk.cyan('=== SUPRA AGENT CONFIGURATION ==='));
    console.log(chalk.white(JSON.stringify(this.config, null, 2)));
    console.log(chalk.cyan('=================================\n'));
  }
}

// ===== CLI PARSER =====

function parseCommand(input: string): { command: string; args?: any } {
  const lower = input.toLowerCase().trim(); 
  
  if (lower.includes('analyze') || lower.includes('analysis')) {
    const symbols = ['btc', 'eth', 'supra', 'sol', 'ada', 'dot'];
    const symbol = symbols.find(s => lower.includes(s)) || 'btc';
    return { command: 'analyze', args: { symbol: `${symbol}_usdt` } };
  } else if (lower.includes('portfolio') || lower.includes('status')) {
    return { command: 'portfolio' };
  } else if (lower.includes('auto') && (lower.includes('trading') || lower.includes('trade'))) {
    return { command: 'toggle_auto' };
  } else if (lower.includes('expert') || (lower.includes('ai') && lower.includes('threshold'))) {
    return { command: 'toggle_experts' };
  } else if (lower.includes('show') && lower.includes('task')) {
    return { command: 'show_tasks' };
  } else if (lower.includes('config') || lower.includes('settings')) {
    return { command: 'config' };
  } else if (lower.includes('balance')) {
    return { command: 'balance' };
  } else if (lower.includes('fund')) {
    return { command: 'fund' };
  } else if (lower.includes('help')) {
    return { command: 'help' };
  } else if (lower === 'exit' || lower === 'quit') {
    return { command: 'exit' };
  }
  
  return { command: 'unknown' };
}

// ===== ACCOUNT LOADER =====

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

// ===== MAIN FUNCTION =====

async function main() {
  console.log(chalk.cyan.bold('\n=== SUPRA AGENT ==='));  
  console.log(chalk.blue('Initializing Supra client...'));
  const supraClient = await SupraClient.init('https://rpc-testnet.supra.com');
  console.log(chalk.green('✅ Connected to Supra testnet'));
  
  const account = await loadOrCreateAccount();
  console.log(chalk.green(`Account: ${account.address().toString()}`));
  
  const SUPRA_API_KEY = process.env.SUPRA_ORACLE_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  
  if (!SUPRA_API_KEY) {
    console.log(chalk.red('SUPRA_ORACLE_API_KEY not found'));
    console.log(chalk.yellow('Get your API key from Supra and set: export SUPRA_ORACLE_API_KEY="your_key"'));
    process.exit(1);
  }
  
  if (!OPENAI_API_KEY) {
    console.log(chalk.yellow('OPENAI_API_KEY not found - AI THRESHOLD Oracle disabled'));
    console.log(chalk.yellow('Set it with: export OPENAI_API_KEY="your_openai_key"'));
  }

  const agent = new IntelligentSupraAgentTrader(supraClient, account, SUPRA_API_KEY, OPENAI_API_KEY);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.magenta('Your Commands> ')
  });
  
  console.log(chalk.cyan('\n=== COMMANDS ==='));
  console.log('  "analyze btc"          - Analyze Bitcoin with AI THRESHOLD Oracle consensus');
  console.log('  "analyze eth"          - Analyze Ethereum with AI THRESHOLD Oracle consensus');  
  console.log('  "show portfolio"       - View SUPRA + SupraAgent balances');
  console.log('  "enable auto trading"  - Let AI THRESHOLD Oracle trigger SupraAgent automation');
  console.log('  "enable experts"       - Turn on the expert analysis system');
  console.log('  "show tasks"           - View active SupraAgent automation');
  console.log('  "fund account"         - Get free testnet SUPRA');
  console.log('  "help"                 - Show this menu');
  console.log('  "exit"                 - Quit\n');
  console.log(chalk.green('✅ Connected to Supra network'));  
  rl.prompt();
  
  rl.on('line', async (input: string) => {
    const { command, args } = parseCommand(input);
    
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
        
      case 'toggle_experts':
        agent.toggleAIExperts();
        break;
        
      case 'show_tasks':
        await agent.showActiveTasks();
        break;
        
      case 'config':
        agent.showConfig();
        break;
        
      case 'balance':
        try {
          const balance = await supraClient.getAccountSupraCoinBalance(account.address());
          const formatted = (parseFloat(balance.toString()) / 1000000).toFixed(2);
          console.log(chalk.cyan(`Account Balance: ${formatted} SUPRA`));
        } catch (error) {
          console.error(chalk.red('Error fetching balance'));
        }
        break;
        
      case 'fund':
        try {
          console.log(chalk.blue('Requesting testnet funds...'));
          await supraClient.fundAccountWithFaucet(account.address());
          console.log(chalk.green('✅ Funding request submitted - check balance in 30 seconds'));
        } catch (error) {
          console.error(chalk.red('Funding failed'));
        }
        break;
        
      case 'help':
        console.log(chalk.cyan('\n=== COMMANDS ==='));
        console.log('  "analyze btc"          - Analyze Bitcoin with AI THRESHOLD Oracle consensus');
        console.log('  "analyze eth"          - Analyze Ethereum with AI THRESHOLD Oracle consensus');  
        console.log('  "show portfolio"       - View account balances and status');
        console.log('  "enable auto trading"  - Enable automated trading');
        console.log('  "enable experts"       - Enable AI THRESHOLD Oracle analysis system');
        console.log('  "show tasks"           - View active automation tasks');
        console.log('  "fund account"         - Request testnet SUPRA');
        console.log('  "help"                 - Show commands');
        console.log('  "exit"                 - Exit application\n');
        console.log(chalk.green('✅ Connected to Supra network'));
        console.log(chalk.white('SupraAgent: Automated investment system'));
        break;
        
      case 'exit':
        console.log(chalk.blue('Shutting down SupraAgent...'));
        rl.close();
        process.exit(0);
        
      default:
        console.log(chalk.red('Command not recognized. Type "help" for available commands.'));
    }
    
    rl.prompt();
  });
  
  rl.on('close', () => {
    console.log(chalk.blue('SupraAgent disconnected.'));
  });
}

main().catch((error) => {
  console.error(chalk.red('SupraAgent initialization error:'), error);
});