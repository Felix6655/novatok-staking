//! Stake Pool state structure.
//!
//! The StakePool account stores global configuration for the staking program.
//!
//! ## Security Invariants
//! - `staking_mint` is set once at initialization and never changes
//! - `staking_vault` and `treasury_vault` are PDAs owned by this account
//! - `authority` is the only account that can modify admin settings
//! - `bump`, `vault_bump`, `treasury_bump` enable PDA verification

use anchor_lang::prelude::*;

/// The main stake pool account that stores global staking configuration.
///
/// This account is a PDA derived from the STAKE_POOL_SEED and is unique per token.
/// It stores APY rates, emission limits, and pool statistics.
///
/// ## Account Size: 249 bytes (including 8-byte discriminator)
#[account]
#[derive(Default)]
pub struct StakePool {
    /// The admin/authority that can modify pool settings.
    /// SECURITY: Only this pubkey can call admin functions.
    pub authority: Pubkey,

    /// The SPL token mint for the staking token (NOVA).
    /// SECURITY: Set once at init, validated on every instruction.
    pub staking_mint: Pubkey,

    /// The vault holding staked tokens (PDA).
    /// SECURITY: PDA owned by this stake_pool, cannot be swapped.
    pub staking_vault: Pubkey,

    /// The treasury vault holding reward tokens (PDA).
    /// SECURITY: PDA owned by this stake_pool, cannot be swapped.
    pub treasury_vault: Pubkey,

    /// APY for Flex tier in basis points (e.g., 400 = 4%).
    /// SECURITY: Capped at MAX_APY (5000 = 50%).
    pub flex_apy: u16,

    /// APY for Core tier in basis points (e.g., 1000 = 10%).
    /// SECURITY: Capped at MAX_APY (5000 = 50%).
    pub core_apy: u16,

    /// APY for Prime tier in basis points (e.g., 1400 = 14%).
    /// SECURITY: Capped at MAX_APY (5000 = 50%).
    pub prime_apy: u16,

    /// Maximum total rewards that can be distributed.
    /// SECURITY: Enforced on every claim, prevents unlimited emission.
    pub emission_cap: u64,

    /// Total rewards already distributed.
    /// SECURITY: Only increases, tracked for cap enforcement.
    pub total_distributed: u64,

    /// Total amount of tokens currently staked in the pool.
    pub total_staked: u64,

    /// Number of active stakers.
    pub staker_count: u64,

    /// Whether staking is currently paused.
    /// SECURITY: When true, only unstake/claim allowed.
    pub paused: bool,

    /// Pool initialization timestamp.
    pub created_at: i64,

    /// Last update timestamp.
    pub last_updated: i64,

    /// Bump seed for stake_pool PDA derivation.
    /// SECURITY: Used to verify PDA in instructions.
    pub bump: u8,

    /// Bump seed for staking_vault PDA.
    /// SECURITY: Used to verify vault PDA.
    pub vault_bump: u8,

    /// Bump seed for treasury_vault PDA.
    /// SECURITY: Used to verify treasury PDA.
    pub treasury_bump: u8,

    /// Reserved space for future upgrades.
    pub _reserved: [u8; 64],
}

impl StakePool {
    /// Calculate the space needed for the StakePool account.
    ///
    /// Returns the total byte size including the 8-byte discriminator.
    pub const LEN: usize = 8 +  // discriminator
        32 +  // authority
        32 +  // staking_mint
        32 +  // staking_vault
        32 +  // treasury_vault
        2 +   // flex_apy
        2 +   // core_apy
        2 +   // prime_apy
        8 +   // emission_cap
        8 +   // total_distributed
        8 +   // total_staked
        8 +   // staker_count
        1 +   // paused
        8 +   // created_at
        8 +   // last_updated
        1 +   // bump
        1 +   // vault_bump
        1 +   // treasury_bump
        64;   // reserved

    /// Get the APY for a specific tier.
    ///
    /// # Arguments
    /// * `tier` - The staking tier (0=Flex, 1=Core, 2=Prime)
    ///
    /// # Returns
    /// The APY in basis points for the specified tier.
    /// Returns 0 for invalid tier (defensive programming).
    pub fn get_apy_for_tier(&self, tier: u8) -> u16 {
        match tier {
            0 => self.flex_apy,
            1 => self.core_apy,
            2 => self.prime_apy,
            _ => 0, // Invalid tier returns 0 APY (no rewards)
        }
    }

    /// Check if the pool is accepting new stakes.
    pub fn is_accepting_stakes(&self) -> bool {
        !self.paused
    }

    /// Calculate remaining emission capacity.
    pub fn remaining_emission_capacity(&self) -> u64 {
        self.emission_cap.saturating_sub(self.total_distributed)
    }
}
