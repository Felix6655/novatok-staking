//! Program constants for the Nova Staking program.
//!
//! This module defines all constant values used throughout the staking program,
//! including time periods, APY limits, and precision values.

use anchor_lang::prelude::*;

/// Seed for deriving the stake pool PDA
pub const STAKE_POOL_SEED: &[u8] = b"stake_pool";

/// Seed for deriving user stake account PDAs
pub const USER_STAKE_SEED: &[u8] = b"user_stake";

/// Seed for deriving the pool vault PDA
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";

/// Seed for deriving the treasury vault PDA
pub const TREASURY_VAULT_SEED: &[u8] = b"treasury_vault";

/// Number of seconds in a day
pub const SECONDS_PER_DAY: i64 = 86_400;

/// Number of seconds in a year (365 days)
pub const SECONDS_PER_YEAR: u64 = 365 * 86_400;

/// Lock period for Core tier in seconds (90 days)
pub const CORE_LOCK_PERIOD: i64 = 90 * SECONDS_PER_DAY;

/// Lock period for Prime tier in seconds (180 days)
pub const PRIME_LOCK_PERIOD: i64 = 180 * SECONDS_PER_DAY;

/// Flex tier has no lock period
pub const FLEX_LOCK_PERIOD: i64 = 0;

/// Default APY for Flex tier (4% = 400 basis points)
pub const DEFAULT_FLEX_APY: u16 = 400;

/// Default APY for Core tier (10% = 1000 basis points)
pub const DEFAULT_CORE_APY: u16 = 1000;

/// Default APY for Prime tier (14% = 1400 basis points)
pub const DEFAULT_PRIME_APY: u16 = 1400;

/// Maximum allowed APY (50% = 5000 basis points)
pub const MAX_APY: u16 = 5000;

/// Basis points denominator (100% = 10000 basis points)
pub const BASIS_POINTS_DENOMINATOR: u64 = 10_000;

/// Precision multiplier for reward calculations to avoid rounding errors
pub const PRECISION: u128 = 1_000_000_000_000; // 10^12

/// Staking tier enum values
pub mod tier {
    /// Flex tier - no lock period, lowest APY
    pub const FLEX: u8 = 0;
    /// Core tier - 90 day lock, medium APY
    pub const CORE: u8 = 1;
    /// Prime tier - 180 day lock, highest APY
    pub const PRIME: u8 = 2;
}
