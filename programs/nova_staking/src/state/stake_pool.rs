//! Stake Pool state structure.
//!
//! The StakePool account stores global configuration for the staking program.

use anchor_lang::prelude::*;

/// The main stake pool account that stores global staking configuration.
///
/// This account is a PDA derived from the STAKE_POOL_SEED and is unique per pool.
/// It stores APY rates, emission limits, and pool statistics.
#[account]
#[derive(Default)]
pub struct StakePool {
    /// The admin/authority that can modify pool settings.
    pub authority: Pubkey,

    /// The SPL token mint for the staking token (NOVA).
    pub staking_mint: Pubkey,

    /// The vault holding staked tokens.
    pub staking_vault: Pubkey,

    /// The treasury vault holding reward tokens.
    pub treasury_vault: Pubkey,

    /// APY for Flex tier in basis points (e.g., 400 = 4%).
    pub flex_apy: u16,

    /// APY for Core tier in basis points (e.g., 1000 = 10%).
    pub core_apy: u16,

    /// APY for Prime tier in basis points (e.g., 1400 = 14%).
    pub prime_apy: u16,

    /// Maximum total rewards that can be distributed.
    pub emission_cap: u64,

    /// Total rewards already distributed.
    pub total_distributed: u64,

    /// Total amount of tokens currently staked in the pool.
    pub total_staked: u64,

    /// Number of active stakers.
    pub staker_count: u64,

    /// Whether staking is currently paused.
    pub paused: bool,

    /// Pool initialization timestamp.
    pub created_at: i64,

    /// Last update timestamp.
    pub last_updated: i64,

    /// Bump seed for PDA derivation.
    pub bump: u8,

    /// Bump seed for vault PDA.
    pub vault_bump: u8,

    /// Bump seed for treasury PDA.
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
    pub fn get_apy_for_tier(&self, tier: u8) -> u16 {
        match tier {
            0 => self.flex_apy,
            1 => self.core_apy,
            2 => self.prime_apy,
            _ => 0,
        }
    }
}
