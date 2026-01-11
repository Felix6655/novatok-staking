//! Error types for the Nova Staking program.
//!
//! This module defines all custom error codes that can be returned by the program.
//! Each error has a unique code and descriptive message.
//!
//! ## Error Code Ranges
//! - 6000-6009: Input validation errors
//! - 6010-6019: State/balance errors
//! - 6020-6029: Time/lock errors
//! - 6030-6039: Math/overflow errors
//! - 6040-6049: Authorization errors
//! - 6050-6059: Account validation errors

use anchor_lang::prelude::*;

/// Custom error codes for the Nova Staking program.
///
/// Error codes start at 6000 (Anchor's custom error offset).
#[error_code]
pub enum StakingError {
    // ========== Input Validation Errors (6000-6009) ==========
    
    /// [6000] Staking operations are currently paused by admin.
    #[msg("Staking is currently paused")]
    StakingPaused,

    /// [6001] The specified staking tier is not valid (must be 0, 1, or 2).
    #[msg("Invalid staking tier specified (must be 0=Flex, 1=Core, 2=Prime)")]
    InvalidTier,

    /// [6002] Cannot stake or fund with zero amount.
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    /// [6003] APY value exceeds the maximum allowed limit (50%).
    #[msg("APY exceeds maximum allowed value of 5000 basis points (50%)")]
    ApyTooHigh,

    /// [6004] New emission cap cannot be less than already distributed rewards.
    #[msg("New emission cap cannot be less than distributed rewards")]
    InvalidEmissionCap,

    /// [6005] Emission cap must be greater than zero.
    #[msg("Emission cap must be greater than zero")]
    ZeroEmissionCap,

    // ========== State/Balance Errors (6010-6019) ==========
    
    /// [6010] User does not have enough staked tokens for the operation.
    #[msg("Insufficient staked balance for this operation")]
    InsufficientStakedBalance,

    /// [6011] No rewards are available to claim.
    #[msg("No rewards available to claim")]
    NoRewardsAvailable,

    /// [6012] The treasury does not have enough funds for the reward payout.
    #[msg("Insufficient treasury funds for reward payout")]
    InsufficientTreasuryFunds,

    /// [6013] Paying this reward would exceed the emission cap.
    #[msg("Emission cap would be exceeded")]
    EmissionCapExceeded,

    /// [6014] No active stake found for this user.
    #[msg("No active stake found for this user")]
    NoActiveStake,

    /// [6015] Cannot change tier while having active stake.
    #[msg("Cannot change tier with active stake - unstake first")]
    CannotChangeTier,

    /// [6016] User stake account is not initialized.
    #[msg("User stake account not initialized")]
    StakeNotInitialized,

    // ========== Time/Lock Errors (6020-6029) ==========
    
    /// [6020] The lock period has not yet ended for this stake.
    #[msg("Lock period has not ended - cannot unstake yet")]
    LockPeriodNotEnded,

    /// [6021] Invalid timestamp detected (clock skew or manipulation).
    #[msg("Invalid timestamp detected")]
    InvalidTimestamp,

    /// [6022] Time calculation would result in negative duration.
    #[msg("Time calculation resulted in negative duration")]
    NegativeTimeDuration,

    // ========== Math/Overflow Errors (6030-6039) ==========
    
    /// [6030] Arithmetic overflow occurred during calculation.
    #[msg("Arithmetic overflow occurred during calculation")]
    MathOverflow,

    /// [6031] Arithmetic underflow occurred during calculation.
    #[msg("Arithmetic underflow occurred during calculation")]
    MathUnderflow,

    /// [6032] Division by zero attempted.
    #[msg("Division by zero attempted")]
    DivisionByZero,

    /// [6033] Integer conversion failed (value out of range).
    #[msg("Integer conversion failed - value out of range")]
    ConversionOverflow,

    // ========== Authorization Errors (6040-6049) ==========
    
    /// [6040] Unauthorized - caller is not the admin.
    #[msg("Unauthorized: caller is not the pool admin")]
    Unauthorized,

    /// [6041] Unauthorized - signer does not match stake owner.
    #[msg("Unauthorized: signer does not match stake owner")]
    InvalidStakeOwner,

    /// [6042] Unauthorized - cannot modify another user's stake.
    #[msg("Unauthorized: cannot modify another user's stake")]
    UnauthorizedStakeAccess,

    // ========== Account Validation Errors (6050-6059) ==========
    
    /// [6050] The provided mint does not match the pool's staking token.
    #[msg("Token mint mismatch - wrong token for this pool")]
    MintMismatch,

    /// [6051] The provided vault does not match the pool's staking vault.
    #[msg("Staking vault address mismatch")]
    VaultMismatch,

    /// [6052] The provided treasury does not match the pool's treasury vault.
    #[msg("Treasury vault address mismatch")]
    TreasuryMismatch,

    /// [6053] The provided stake pool does not match expected PDA.
    #[msg("Stake pool address mismatch")]
    PoolMismatch,

    /// [6054] User stake account does not belong to this pool.
    #[msg("User stake account does not belong to this pool")]
    StakePoolMismatch,

    /// [6055] Vault owner is not the stake pool PDA.
    #[msg("Vault owner must be the stake pool PDA")]
    InvalidVaultOwner,

    /// [6056] Treasury owner is not the stake pool PDA.
    #[msg("Treasury owner must be the stake pool PDA")]
    InvalidTreasuryOwner,

    /// [6057] Account is not a valid PDA with expected seeds.
    #[msg("Invalid PDA - account does not match expected seeds")]
    InvalidPDA,

    /// [6058] Token account mint does not match expected mint.
    #[msg("Token account mint does not match pool staking mint")]
    InvalidTokenAccountMint,

    /// [6059] Bump seed mismatch for PDA validation.
    #[msg("PDA bump seed mismatch")]
    BumpMismatch,
}
