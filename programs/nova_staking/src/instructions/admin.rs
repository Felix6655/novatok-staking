//! Admin instruction handlers.
//!
//! Handles admin-only operations for the staking pool.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StakingError;
use crate::state::StakePool;

/// Accounts required for admin operations.
#[derive(Accounts)]
pub struct AdminControl<'info> {
    /// The admin authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The stake pool to modify.
    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.staking_mint.as_ref()],
        bump = stake_pool.bump,
        has_one = authority @ StakingError::Unauthorized
    )]
    pub stake_pool: Account<'info, StakePool>,
}

/// Set the paused state of the staking pool.
///
/// When paused, new stakes are not allowed. Unstaking and claiming
/// rewards are still permitted.
///
/// # Arguments
/// * `ctx` - AdminControl accounts context
/// * `paused` - True to pause, false to unpause
///
/// # Returns
/// Result indicating success or error
pub fn set_paused_handler(ctx: Context<AdminControl>, paused: bool) -> Result<()> {
    let stake_pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;

    let previous_state = stake_pool.paused;
    stake_pool.paused = paused;
    stake_pool.last_updated = clock.unix_timestamp;

    msg!(
        "Staking {} (was {})",
        if paused { "PAUSED" } else { "RESUMED" },
        if previous_state { "paused" } else { "active" }
    );

    Ok(())
}

/// Adjust APY rates for all tiers.
///
/// This affects future reward calculations. Existing rewards already
/// accrued are not affected.
///
/// # Arguments
/// * `ctx` - AdminControl accounts context
/// * `flex_apy` - New Flex tier APY (basis points)
/// * `core_apy` - New Core tier APY (basis points)
/// * `prime_apy` - New Prime tier APY (basis points)
///
/// # Returns
/// Result indicating success or error
pub fn adjust_apy_handler(
    ctx: Context<AdminControl>,
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

    msg!(
        "Adjusting APY rates - Old: Flex={}bp, Core={}bp, Prime={}bp",
        stake_pool.flex_apy,
        stake_pool.core_apy,
        stake_pool.prime_apy
    );

    stake_pool.flex_apy = flex_apy;
    stake_pool.core_apy = core_apy;
    stake_pool.prime_apy = prime_apy;
    stake_pool.last_updated = clock.unix_timestamp;

    msg!(
        "New APY rates - Flex={}bp, Core={}bp, Prime={}bp",
        flex_apy,
        core_apy,
        prime_apy
    );

    Ok(())
}

/// Update the emission cap.
///
/// The new cap cannot be less than the amount already distributed.
///
/// # Arguments
/// * `ctx` - AdminControl accounts context
/// * `new_cap` - New emission cap value
///
/// # Returns
/// Result indicating success or error
pub fn update_emission_cap_handler(ctx: Context<AdminControl>, new_cap: u64) -> Result<()> {
    let stake_pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;

    // Ensure new cap is not less than already distributed
    require!(
        new_cap >= stake_pool.total_distributed,
        StakingError::InvalidEmissionCap
    );

    let old_cap = stake_pool.emission_cap;
    stake_pool.emission_cap = new_cap;
    stake_pool.last_updated = clock.unix_timestamp;

    msg!("Emission cap updated: {} -> {}", old_cap, new_cap);
    msg!("Total distributed: {}", stake_pool.total_distributed);
    msg!("Remaining capacity: {}", new_cap.saturating_sub(stake_pool.total_distributed));

    Ok(())
}
