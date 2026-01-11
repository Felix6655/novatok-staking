/**
 * Test Utilities for Nova Staking Program
 *
 * Helper functions for deterministic testing with integer math only.
 */

import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

// Seed constants
export const SEEDS = {
  STAKE_POOL: Buffer.from("stake_pool"),
  USER_STAKE: Buffer.from("user_stake"),
  POOL_VAULT: Buffer.from("pool_vault"),
  TREASURY_VAULT: Buffer.from("treasury_vault"),
};

// Tier constants
export const TIERS = {
  FLEX: 0,
  CORE: 1,
  PRIME: 2,
};

// Time constants (all integers)
export const TIME = {
  SECONDS_PER_DAY: 86400,
  SECONDS_PER_YEAR: 31536000, // 365 * 86400
  CORE_LOCK_DAYS: 90,
  PRIME_LOCK_DAYS: 180,
  get CORE_LOCK_SECONDS() {
    return this.CORE_LOCK_DAYS * this.SECONDS_PER_DAY;
  },
  get PRIME_LOCK_SECONDS() {
    return this.PRIME_LOCK_DAYS * this.SECONDS_PER_DAY;
  },
};

// APY constants (in basis points - integer only)
export const APY = {
  FLEX: 400, // 4%
  CORE: 1000, // 10%
  PRIME: 1400, // 14%
  MAX: 5000, // 50%
  BASIS_POINTS: 10000, // 100%
};

/**
 * Derives all PDAs for a staking pool.
 * Uses only deterministic operations.
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
  // Convert all to BN for safe integer math
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
      throw new Error(`Invalid tier: ${tier}`);
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
      throw new Error(`Invalid tier: ${tier}`);
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
 * Create test amounts using only integer values.
 * All amounts are in smallest token unit (e.g., lamports for SOL, or base units for SPL).
 */
export const AMOUNTS = {
  // Assuming 6 decimals
  ONE_TOKEN: new BN(1_000_000), // 1 token
  HUNDRED_TOKENS: new BN(100_000_000), // 100 tokens
  THOUSAND_TOKENS: new BN(1_000_000_000), // 1000 tokens
  HUNDRED_THOUSAND: new BN(100_000_000_000), // 100K tokens
  MILLION_TOKENS: new BN(1_000_000_000_000), // 1M tokens
};

/**
 * Assert BN values are equal with descriptive error.
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
 * Assert BN value is within tolerance (for approximate comparisons).
 * Uses integer tolerance value.
 */
export function assertBNWithinTolerance(
  actual: BN,
  expected: BN,
  tolerancePercentBasisPoints: number, // e.g., 100 = 1%
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
