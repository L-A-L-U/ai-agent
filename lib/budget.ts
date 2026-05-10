const DAILY_BUDGET = Number(process.env.AI_AGENT_DAILY_TOKEN_BUDGET ?? 200_000);

interface DailyUsage {
  date: string;
  tokens: number;
}

let usage: DailyUsage = { date: utcDate(), tokens: 0 };

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isBudgetExceeded(): boolean {
  const today = utcDate();
  if (usage.date !== today) {
    usage = { date: today, tokens: 0 };
  }
  return usage.tokens >= DAILY_BUDGET;
}

export function recordUsage(inputTokens: number, outputTokens: number): void {
  const today = utcDate();
  if (usage.date !== today) {
    usage = { date: today, tokens: 0 };
  }
  usage.tokens += inputTokens + outputTokens;
}

export function getBudgetStatus(): { date: string; tokensUsed: number; budget: number; remaining: number } {
  const today = utcDate();
  if (usage.date !== today) {
    usage = { date: today, tokens: 0 };
  }
  return {
    date: usage.date,
    tokensUsed: usage.tokens,
    budget: DAILY_BUDGET,
    remaining: Math.max(0, DAILY_BUDGET - usage.tokens),
  };
}
