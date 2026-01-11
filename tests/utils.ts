/**
 * Test Utilities for Nova Staking Program
 *
 * Helper functions for deterministic testing with integer math only.
 * Compatible with localnet testing.
 */

import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

// ============================================
// SEED CONSTANTS (must match program)
// ============================================

export const SEEDS = {
  STAKE_POOL: Buffer.from("stake_pool"),
  USER_STAKE: Buffer.from("user_stake"),
  POOL_VAULT: Buffer.from("pool_vault"),
  TREASURY_VAULT: Buffer.from("treasury_vault"),
} as const;

// ============================================
// TIER CONSTANTS
// ============================================

export const TIERS = {
  FLEX: 0,
  CORE: 1,
  PRIME: 2,
} as const;

export const TIER_NAMES: Record<number, string> = {
  0: "Flex",
  1: "Core",
  2: "Prime",
};

// ============================================
// TIME CONSTANTS (all integers)
// ============================================

export const TIME = {
  SECONDS_PER_MINUTE: 60,
  SECONDS_PER_HOUR: 3600,
  SECONDS_PER_DAY: 86400,
  SECONDS_PER_YEAR: 31536000, // 365 * 86400
  CORE_LOCK_DAYS: 90,
  PRIME_LOCK_DAYS: 180,

  get CORE_LOCK_SECONDS(): number {
    return this.CORE_LOCK_DAYS * this.SECONDS_PER_DAY;
  },
  get PRIME_LOCK_SECONDS(): number {
    return this.PRIME_LOCK_DAYS * this.SECONDS_PER_DAY;
  },
} as const;

// ============================================
// APY CONSTANTS (basis points - integer only)
// ============================================

export const APY = {
  FLEX: 400,        // 4%
  CORE: 1000,       // 10%
  PRIME: 1400,      // 14%
  MAX: 5000,        // 50%
  BASIS_POINTS: 10000,  // 100%
} as const;

// ============================================
// TOKEN CONSTANTS
// ============================================

export const TOKEN = {
  DECIMALS: 6,
  get ONE(): BN {
    return new BN(10 ** this.DECIMALS);
  },
  get HUNDRED(): BN {
    return this.ONE.mul(new BN(100));
  },
  get THOUSAND(): BN {
    return this.ONE.mul(new BN(1000));
  },
  get HUNDRED_THOUSAND(): BN {
    return this.ONE.mul(new BN(100_000));
  },
  get MILLION(): BN {
    return this.ONE.mul(new BN(1_000_000));
  },
} as const;

// ============================================
// PDA DERIVATION HELPERS
// ============================================

/**
 * Derive all PDAs for a staking pool.
 * All operations are deterministic.
 */
export function derivePDAs(
  programId: PublicKey,
  stakingMint: PublicKey,
  userPubkey?: PublicKey
): {
  stakePool: [PublicKey, number];
  stakingVault: [PublicKey, number];
  treasuryVault: [PublicKey, number];
  userStake?: [PublicKey, number];
} {
  const [stakePool, stakePoolBump] = PublicKey.findProgramAddressSync(
    [SEEDS.STAKE_POOL, stakingMint.toBuffer()],
    programId
  );

  const [stakingVault, vaultBump] = PublicKey.findProgramAddressSync(
    [SEEDS.POOL_VAULT, stakePool.toBuffer()],
    programId
  );

  const [treasuryVault, treasuryBump] = PublicKey.findProgramAddressSync(
    [SEEDS.TREASURY_VAULT, stakePool.toBuffer()],
    programId
  );

  const result: ReturnType<typeof derivePDAs> = {
    stakePool: [stakePool, stakePoolBump],
    stakingVault: [stakingVault, vaultBump],
    treasuryVault: [treasuryVault, treasuryBump],
  };

  if (userPubkey) {
    const [userStake, userStakeBump] = PublicKey.findProgramAddressSync(
      [SEEDS.USER_STAKE, stakePool.toBuffer(), userPubkey.toBuffer()],
      programId
    );
    result.userStake = [userStake, userStakeBump];
  }

  return result;
}

/**
 * Derive user stake PDA for a specific user and pool.
 */
export function deriveUserStakePDA(
  programId: PublicKey,
  stakePool: PublicKey,
  userPubkey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.USER_STAKE, stakePool.toBuffer(), userPubkey.toBuffer()],
    programId
  );
}

// ============================================
// REWARD CALCULATIONS (integer math only)
// ============================================

/**
 * Calculate expected rewards using integer math only.
 *
 * Formula: rewards = stakedAmount * apyBasisPoints * timeSeconds / (BASIS_POINTS * SECONDS_PER_YEAR)
 *
 * All operations use BN for arbitrary precision integer arithmetic.
 */
export function calculateRewards(
  stakedAmount: BN,
  apyBasisPoints: number,
  timeElapsedSeconds: number
): BN {
  if (stakedAmount.isZero() || apyBasisPoints === 0 || timeElapsedSeconds <= 0) {
    return new BN(0);
  }

  const amount = new BN(stakedAmount);
  const apy = new BN(apyBasisPoints);
  const time = new BN(timeElapsedSeconds);
  const basisPoints = new BN(APY.BASIS_POINTS);
  const yearSeconds = new BN(TIME.SECONDS_PER_YEAR);

  // Calculate: amount * apy * time / (basisPoints * yearSeconds)
  const numerator = amount.mul(apy).mul(time);
  const denominator = basisPoints.mul(yearSeconds);

  return numerator.div(denominator);
}

/**
 * Get APY for a given tier.
 */
export function getApyForTier(tier: number): number {
  switch (tier) {
    case TIERS.FLEX:
      return APY.FLEX;
    case TIERS.CORE:
      return APY.CORE;
    case TIERS.PRIME:
      return APY.PRIME;
    default:
      return 0;
  }
}

/**
 * Get lock period for a given tier (in seconds).
 */
export function getLockPeriodForTier(tier: number): number {
  switch (tier) {
    case TIERS.FLEX:
      return 0;
    case TIERS.CORE:
      return TIME.CORE_LOCK_SECONDS;
    case TIERS.PRIME:
      return TIME.PRIME_LOCK_SECONDS;
    default:
      return 0;
  }
}

/**
 * Check if lock period has ended.
 */
export function isLockEnded(
  stakeStartTime: number,
  tier: number,
  currentTime: number
): boolean {
  const lockPeriod = getLockPeriodForTier(tier);
  if (lockPeriod === 0) return true;
  return currentTime >= stakeStartTime + lockPeriod;
}

/**
 * Calculate remaining lock time.
 */
export function remainingLockTime(
  stakeStartTime: number,
  tier: number,
  currentTime: number
): number {
  const lockPeriod = getLockPeriodForTier(tier);
  if (lockPeriod === 0) return 0;

  const lockEnd = stakeStartTime + lockPeriod;
  return currentTime >= lockEnd ? 0 : lockEnd - currentTime;
}

// ============================================
// BN ASSERTION HELPERS
// ============================================

/**
 * Assert BN values are equal.
 */
export function assertBNEqual(actual: BN, expected: BN, message?: string): void {
  if (!actual.eq(expected)) {
    throw new Error(
      `${message || "BN assertion failed"}: expected ${expected.toString()}, got ${actual.toString()}`
    );
  }
}

/**
 * Assert BN value is greater than another.
 */
export function assertBNGreaterThan(
  actual: BN,
  expected: BN,
  message?: string
): void {
  if (!actual.gt(expected)) {
    throw new Error(
      `${message || "BN assertion failed"}: expected ${actual.toString()} > ${expected.toString()}`
    );
  }
}

/**
 * Assert BN value is greater than or equal to another.
 */
export function assertBNGreaterThanOrEqual(
  actual: BN,
  expected: BN,
  message?: string
): void {
  if (!actual.gte(expected)) {
    throw new Error(
      `${message || "BN assertion failed"}: expected ${actual.toString()} >= ${expected.toString()}`
    );
  }
}

/**
 * Assert BN value is less than another.
 */
export function assertBNLessThan(
  actual: BN,
  expected: BN,
  message?: string
): void {
  if (!actual.lt(expected)) {
    throw new Error(
      `${message || "BN assertion failed"}: expected ${actual.toString()} < ${expected.toString()}`
    );
  }
}

/**
 * Assert BN value is within tolerance (for approximate comparisons).
 * Uses integer tolerance value (basis points).
 */
export function assertBNWithinTolerance(
  actual: BN,
  expected: BN,
  tolerancePercentBasisPoints: number,
  message?: string
): void {
  // Calculate tolerance: expected * tolerancePercent / 10000
  const tolerance = expected
    .mul(new BN(tolerancePercentBasisPoints))
    .div(new BN(APY.BASIS_POINTS));

  const diff = actual.sub(expected).abs();

  if (diff.gt(tolerance)) {
    throw new Error(
      `${message || "BN tolerance assertion failed"}: ` +
        `expected ${expected.toString()} ± ${tolerance.toString()}, ` +
        `got ${actual.toString()} (diff: ${diff.toString()})`
    );
  }
}

// ============================================
// FORMATTING HELPERS
// ============================================

/**
 * Format BN token amount to human-readable string.
 */
export function formatTokenAmount(amount: BN, decimals: number = TOKEN.DECIMALS): string {
  const divisor = new BN(10).pow(new BN(decimals));
  const whole = amount.div(divisor);
  const fraction = amount.mod(divisor);

  const fractionStr = fraction.toString().padStart(decimals, "0");
  return `${whole.toString()}.${fractionStr}`;
}

/**
 * Format seconds to human-readable duration.
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";

  const days = Math.floor(seconds / TIME.SECONDS_PER_DAY);
  const hours = Math.floor((seconds % TIME.SECONDS_PER_DAY) / TIME.SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % TIME.SECONDS_PER_HOUR) / TIME.SECONDS_PER_MINUTE);
  const secs = seconds % TIME.SECONDS_PER_MINUTE;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 && parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ") || "0s";
}

/**
 * Format APY basis points to percentage string.
 */
export function formatAPY(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

// ============================================
// TEST DATA GENERATORS
// ============================================

/**
 * Generate deterministic test amounts.
 */
export const TEST_AMOUNTS = {
  SMALL_STAKE: TOKEN.THOUSAND,           // 1,000 tokens
  MEDIUM_STAKE: TOKEN.HUNDRED_THOUSAND,  // 100,000 tokens
  LARGE_STAKE: TOKEN.MILLION,            // 1,000,000 tokens
  TREASURY_FUND: TOKEN.MILLION.mul(new BN(5)),  // 5,000,000 tokens
  EMISSION_CAP: TOKEN.MILLION.mul(new BN(10)),  // 10,000,000 tokens
} as const;
