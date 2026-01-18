/// Admin instruction handlers.
///
/// Handles admin-only operations for the staking pool.
///
/// ## Security Guarantees
/// - All admin functions require signer == pool.authority
/// - PDA validation ensures correct pool
/// - Parameter bounds checking

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StakingError;
use crate::state::StakePool;

/// Accounts required for admin operations.
///
/// ## Security Notes
/// - Authority must be signer
/// - Authority must match stake_pool.authority (has_one constraint)
/// - Pool PDA validated via seeds
#[derive(Accounts)]
pub struct AdminControl<'info> {
    /// The admin authority.
    /// SECURITY: Must be signer AND match pool.authority.
    #[account(
        mut,
        constraint = authority.key() == stake_pool.authority @ StakingError::Unauthorized
    )]
    pub authority: Signer<'info>,

    /// The stake pool to modify.
    /// SECURITY: PDA validation + has_one authority.
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
/// # Security
/// - Only pool.authority can call this
/// - When paused, new stakes are blocked
/// - Unstaking and claiming remain available (user funds not locked)
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
    msg!("Admin: {}", ctx.accounts.authority.key());

    Ok(())
}

/// Adjust APY rates for all tiers.
///
/// # Security
/// - Only pool.authority can call this
/// - APY values capped at MAX_APY (50%)
/// - Changes only affect future reward calculations
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
    // === INPUT VALIDATION ===
    
    // Validate APY values don't exceed maximum (50% = 5000 basis points)
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

    // Update APY values
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
    msg!("Admin: {}", ctx.accounts.authority.key());

    Ok(())
}

/// Update the emission cap.
///
/// # Security
/// - Only pool.authority can call this
/// - New cap cannot be less than already distributed rewards
/// - Prevents admin from stranding user rewards
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

    // === INPUT VALIDATION ===
    
    // New cap must be non-zero
    require!(new_cap > 0, StakingError::ZeroEmissionCap);
    
    // Ensure new cap is not less than already distributed
    // This prevents admin from "stealing" pending rewards
    require!(
        new_cap >= stake_pool.total_distributed,
        StakingError::InvalidEmissionCap
    );

    let old_cap = stake_pool.emission_cap;
    stake_pool.emission_cap = new_cap;
    stake_pool.last_updated = clock.unix_timestamp;

    // Calculate remaining capacity (checked sub for safety)
    let remaining = new_cap
        .checked_sub(stake_pool.total_distributed)
        .unwrap_or(0);

    msg!("Emission cap updated: {} -> {}", old_cap, new_cap);
    msg!("Total distributed: {}", stake_pool.total_distributed);
    msg!("Remaining capacity: {}", remaining);
    msg!("Admin: {}", ctx.accounts.authority.key());

    Ok(())
}

/// Transfer admin authority to a new address.
///
/// # Security
/// - Only current authority can call this
/// - New authority must be a valid pubkey (non-zero)
/// - Two-step transfer recommended for production
///
/// # Arguments
/// * `ctx` - AdminControl accounts context
/// * `new_authority` - New admin pubkey
///
/// # Returns
/// Result indicating success or error
pub fn transfer_authority_handler(
    ctx: Context<AdminControl>,
    new_authority: Pubkey,
) -> Result<()> {
    let stake_pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;

    // Validate new authority is not zero address
    require!(
        new_authority != Pubkey::default(),
        StakingError::Unauthorized
    );

    let old_authority = stake_pool.authority;
    stake_pool.authority = new_authority;
    stake_pool.last_updated = clock.unix_timestamp;

    msg!("Authority transferred: {} -> {}", old_authority, new_authority);

    Ok(())
}
