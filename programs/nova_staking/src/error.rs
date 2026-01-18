use anchor_lang::prelude::*;

#[error_code]
pub enum StakingError {
    #[msg("Staking is paused")]
    StakingPaused,

    #[msg("Invalid tier")]
    InvalidTier,

    #[msg("Lock not ended")]
    LockNotEnded,

    #[msg("Lock period not ended")]
    LockPeriodNotEnded,

    #[msg("Insufficient staked balance")]
    InsufficientStakedBalance,

    #[msg("Invalid timestamp")]
    InvalidTimestamp,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Math underflow")]
    MathUnderflow,

    #[msg("Conversion overflow")]
    ConversionOverflow,

    #[msg("Invalid vault owner")]
    InvalidVaultOwner,

    #[msg("Invalid stake owner")]
    InvalidStakeOwner,

    #[msg("Invalid token account mint")]
    InvalidTokenAccountMint,

    #[msg("Mint mismatch")]
    MintMismatch,

    #[msg("Unauthorized stake access")]
    UnauthorizedStakeAccess,

    #[msg("Vault mismatch")]
    VaultMismatch,

    #[msg("Stake pool mismatch")]
    StakePoolMismatch,

    #[msg("Zero amount")]
    ZeroAmount,

    #[msg("No active stake")]
    NoActiveStake,
}
