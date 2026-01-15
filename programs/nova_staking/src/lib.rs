//! # Nova Staking Program
//!
//! A single-token, time-locked staking program for the NOVA token.
//! Supports three tiers with different lock periods and APY rates:
//!
//! - **Flex**: No lock period, 4% APY
//! - **Core**: 90-day lock, 10% APY
//! - **Prime**: 180-day lock, 14% APY
//!
//! ## Features
//! - Linear reward accrual based on staking duration
//! - Claim rewards without unstaking
//! - Treasury-funded rewards with emission cap
//! - Admin controls for pausing and APY adjustments
//! - Safe math with overflow protection
//!
//! ## Devnet Only
//! This program is configured for Solana devnet deployment only.

use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

#[program]
pub mod nova_staking {
    use super::*;

    /// Initializes the staking pool with the given parameters.
    ///
    /// # Arguments
    /// * `ctx` - The context containing all accounts needed for initialization
    /// * `emission_cap` - Maximum total rewards that can be distributed
    /// * `flex_apy` - APY for Flex tier (in basis points, e.g., 400 = 4%)
    /// * `core_apy` - APY for Core tier (in basis points, e.g., 1000 = 10%)
    /// * `prime_apy` - APY for Prime tier (in basis points, e.g., 1400 = 14%)
    ///
    /// # Errors
    /// Returns an error if APY values are invalid or exceed maximum limits.
    pub fn initialize(
        ctx: Context<Initialize>,
        emission_cap: u64,
        flex_apy: u16,
        core_apy: u16,
        prime_apy: u16,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, emission_cap, flex_apy, core_apy, prime_apy)
    }

    /// Stakes NOVA tokens in the specified tier.
    ///
    /// # Arguments
    /// * `ctx` - The context containing all accounts needed for staking
    /// * `amount` - Amount of NOVA tokens to stake
    /// * `tier` - Staking tier (0 = Flex, 1 = Core, 2 = Prime)
    ///
    /// # Errors
    /// Returns an error if:
    /// - Staking is paused
    /// - Amount is zero
    /// - Invalid tier specified
    /// - Insufficient balance
    pub fn stake(ctx: Context<Stake>, amount: u64, tier: u8) -> Result<()> {
        instructions::stake::handler(ctx, amount, tier)
    }

    /// Unstakes NOVA tokens from the user's stake account.
    ///
    /// # Arguments
    /// * `ctx` - The context containing all accounts needed for unstaking
    /// * `amount` - Amount of NOVA tokens to unstake
    ///
    /// # Errors
    /// Returns an error if:
    /// - Lock period has not ended (for Core/Prime tiers)
    /// - Amount exceeds staked balance
    /// - Amount is zero
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        instructions::unstake::handler(ctx, amount)
    }

    /// Claims accumulated rewards without unstaking.
    ///
    /// # Arguments
    /// * `ctx` - The context containing all accounts needed for claiming
    ///
    /// # Errors
    /// Returns an error if:
    /// - No rewards available
    /// - Treasury has insufficient funds
    /// - Emission cap would be exceeded
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::claim_rewards::handler(ctx)
    }

    /// Admin function to pause or unpause staking.
    ///
    /// # Arguments
    /// * `ctx` - The context containing admin accounts
    /// * `paused` - True to pause, false to unpause
    ///
    /// # Errors
    /// Returns an error if caller is not the admin.
    pub fn set_paused(ctx: Context<AdminControl>, paused: bool) -> Result<()> {
        instructions::admin::set_paused_handler(ctx, paused)
    }

    /// Admin function to adjust APY rates for all tiers.
    ///
    /// # Arguments
    /// * `ctx` - The context containing admin accounts
    /// * `flex_apy` - New APY for Flex tier (basis points)
    /// * `core_apy` - New APY for Core tier (basis points)
    /// * `prime_apy` - New APY for Prime tier (basis points)
    ///
    /// # Errors
    /// Returns an error if:
    /// - Caller is not the admin
    /// - APY values exceed maximum limits
    pub fn adjust_apy(
        ctx: Context<AdminControl>,
        flex_apy: u16,
        core_apy: u16,
        prime_apy: u16,
    ) -> Result<()> {
        instructions::admin::adjust_apy_handler(ctx, flex_apy, core_apy, prime_apy)
    }

    /// Admin function to update the emission cap.
    ///
    /// # Arguments
    /// * `ctx` - The context containing admin accounts
    /// * `new_cap` - New emission cap value
    ///
    /// # Errors
    /// Returns an error if:
    /// - Caller is not the admin
    /// - New cap is less than already distributed rewards
    pub fn update_emission_cap(ctx: Context<AdminControl>, new_cap: u64) -> Result<()> {
        instructions::admin::update_emission_cap_handler(ctx, new_cap)
    }

    /// Funds the reward treasury with NOVA tokens.
    ///
    /// # Arguments
    /// * `ctx` - The context containing funding accounts
    /// * `amount` - Amount of NOVA tokens to fund
    ///
    /// # Errors
    /// Returns an error if amount is zero or insufficient balance.
    pub fn fund_treasury(ctx: Context<FundTreasury>, amount: u64) -> Result<()> {
        instructions::fund_treasury::handler(ctx, amount)
    }

    /// Admin function to transfer authority to a new address.
    ///
    /// # Arguments
    /// * `ctx` - The context containing admin accounts
    /// * `new_authority` - New admin pubkey
    ///
    /// # Errors
    /// Returns an error if:
    /// - Caller is not the current admin
    /// - New authority is zero address
    pub fn transfer_authority(ctx: Context<AdminControl>, new_authority: Pubkey) -> Result<()> {
        instructions::admin::transfer_authority_handler(ctx, new_authority)
    }
}
