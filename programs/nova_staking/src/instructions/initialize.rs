//! Initialize instruction handler.
//!
//! Creates and configures a new staking pool.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::StakingError;
use crate::state::StakePool;

/// Accounts required for pool initialization.
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The admin authority that will control the pool.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The stake pool account to be created.
    #[account(
        init,
        payer = authority,
        space = StakePool::LEN,
        seeds = [STAKE_POOL_SEED, staking_mint.key().as_ref()],
        bump
    )]
    pub stake_pool: Account<'info, StakePool>,

    /// The mint for the staking token (NOVA).
    pub staking_mint: Account<'info, Mint>,

    /// The vault that will hold staked tokens.
    #[account(
        init,
        payer = authority,
        seeds = [POOL_VAULT_SEED, stake_pool.key().as_ref()],
        bump,
        token::mint = staking_mint,
        token::authority = stake_pool
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    /// The treasury vault that will hold reward tokens.
    #[account(
        init,
        payer = authority,
        seeds = [TREASURY_VAULT_SEED, stake_pool.key().as_ref()],
        bump,
        token::mint = staking_mint,
        token::authority = stake_pool
    )]
    pub treasury_vault: Account<'info, TokenAccount>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,

    /// Token program for token account operations.
    pub token_program: Program<'info, Token>,

    /// Rent sysvar for rent-exempt calculations.
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize a new staking pool.
///
/// # Arguments
/// * `ctx` - Initialize accounts context
/// * `emission_cap` - Maximum total rewards distributable
/// * `flex_apy` - Flex tier APY (basis points)
/// * `core_apy` - Core tier APY (basis points)
/// * `prime_apy` - Prime tier APY (basis points)
///
/// # Returns
/// Result indicating success or error
pub fn handler(
    ctx: Context<Initialize>,
    emission_cap: u64,
    flex_apy: u16,
    core_apy: u16,
    prime_apy: u16,
) -> Result<()> {
    // Validate APY values don't exceed maximum
    require!(flex_apy <= MAX_APY, StakingError::ApyTooHigh);
    require!(core_apy <= MAX_APY, StakingError::ApyTooHigh);
    require!(prime_apy <= MAX_APY, StakingError::ApyTooHigh);

    let stake_pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;

    // Initialize pool state
    stake_pool.authority = ctx.accounts.authority.key();
    stake_pool.staking_mint = ctx.accounts.staking_mint.key();
    stake_pool.staking_vault = ctx.accounts.staking_vault.key();
    stake_pool.treasury_vault = ctx.accounts.treasury_vault.key();
    stake_pool.flex_apy = flex_apy;
    stake_pool.core_apy = core_apy;
    stake_pool.prime_apy = prime_apy;
    stake_pool.emission_cap = emission_cap;
    stake_pool.total_distributed = 0;
    stake_pool.total_staked = 0;
    stake_pool.staker_count = 0;
    stake_pool.paused = false;
    stake_pool.created_at = clock.unix_timestamp;
    stake_pool.last_updated = clock.unix_timestamp;
    stake_pool.bump = ctx.bumps.stake_pool;
    stake_pool.vault_bump = ctx.bumps.staking_vault;
    stake_pool.treasury_bump = ctx.bumps.treasury_vault;

    msg!("Nova Staking Pool initialized successfully");
    msg!("Emission Cap: {}", emission_cap);
    msg!("Flex APY: {} basis points", flex_apy);
    msg!("Core APY: {} basis points", core_apy);
    msg!("Prime APY: {} basis points", prime_apy);

    Ok(())
}
