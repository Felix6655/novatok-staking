//! Error types for the Nova Staking program.
//!
//! This module defines all custom error codes that can be returned by the program.
//! Each error has a unique code and descriptive message.

use anchor_lang::prelude::*;

/// Custom error codes for the Nova Staking program.
///
/// Error codes start at 6000 (Anchor's custom error offset).
#[error_code]
pub enum StakingError {
    /// Staking operations are currently paused by admin.
    #[msg("Staking is currently paused")]
    StakingPaused,

    /// The specified staking tier is not valid (must be 0, 1, or 2).
    #[msg("Invalid staking tier specified")]
    InvalidTier,

    /// Cannot stake or fund with zero amount.
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    /// User does not have enough staked tokens for the operation.
    #[msg("Insufficient staked balance")]
    InsufficientStakedBalance,

    /// The lock period has not yet ended for this stake.
    #[msg("Lock period has not ended yet")]
    LockPeriodNotEnded,

    /// No rewards are available to claim.
    #[msg("No rewards available to claim")]
    NoRewardsAvailable,

    /// The treasury does not have enough funds for the reward payout.
    #[msg("Insufficient treasury funds for reward payout")]
    InsufficientTreasuryFunds,

    /// Paying this reward would exceed the emission cap.
    #[msg("Emission cap would be exceeded")]
    EmissionCapExceeded,

    /// APY value exceeds the maximum allowed limit.
    #[msg("APY exceeds maximum allowed value")]
    ApyTooHigh,

    /// New emission cap cannot be less than already distributed rewards.
    #[msg("New emission cap cannot be less than distributed rewards")]
    InvalidEmissionCap,

    /// Arithmetic overflow occurred during calculation.
    #[msg("Arithmetic overflow occurred")]
    MathOverflow,

    /// User already has an active stake in this pool.
    #[msg("User already has an active stake - use existing stake account")]
    StakeAlreadyExists,

    /// No active stake found for this user.
    #[msg("No active stake found")]
    NoActiveStake,

    /// The provided mint does not match the pool's staking token.
    #[msg("Token mint mismatch")]
    MintMismatch,

    /// Cannot change tier while having active stake.
    #[msg("Cannot change tier with active stake")]
    CannotChangeTier,

    /// Unauthorized - caller is not the admin.
    #[msg("Unauthorized: caller is not admin")]
    Unauthorized,
}
