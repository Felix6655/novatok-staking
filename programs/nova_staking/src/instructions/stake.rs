//! Stake instruction handler.
//!
//! Handles staking NOVA tokens into the pool.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::StakingError;
use crate::state::{StakePool, UserStake};

/// Accounts required for staking.
#[derive(Accounts)]
pub struct Stake<'info> {
    /// The user staking tokens.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The stake pool.
    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.staking_mint.as_ref()],
        bump = stake_pool.bump,
        has_one = staking_vault,
        has_one = staking_mint
    )]
    pub stake_pool: Account<'info, StakePool>,

    /// User's stake account (created if first time staking).
    #[account(
        init_if_needed,
        payer = user,
        space = UserStake::LEN,
        seeds = [USER_STAKE_SEED, stake_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,

    /// The staking token mint.
    pub staking_mint: Account<'info, Mint>,

    /// User's token account for the staking token.
    #[account(
        mut,
        constraint = user_token_account.mint == staking_mint.key() @ StakingError::MintMismatch,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Pool's staking vault.
    #[account(
        mut,
        constraint = staking_vault.key() == stake_pool.staking_vault
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    /// System program.
    pub system_program: Program<'info, System>,

    /// Token program.
    pub token_program: Program<'info, Token>,

    /// Rent sysvar.
    pub rent: Sysvar<'info, Rent>,
}

/// Stake tokens into the pool.
///
/// # Arguments
/// * `ctx` - Stake accounts context
/// * `amount` - Amount of tokens to stake
/// * `tier` - Staking tier (0=Flex, 1=Core, 2=Prime)
///
/// # Returns
/// Result indicating success or error
pub fn handler(ctx: Context<Stake>, amount: u64, tier: u8) -> Result<()> {
    let stake_pool = &ctx.accounts.stake_pool;
    let user_stake = &ctx.accounts.user_stake;

    // Validate pool is not paused
    require!(!stake_pool.paused, StakingError::StakingPaused);

    // Validate amount
    require!(amount > 0, StakingError::ZeroAmount);

    // Validate tier
    require!(
        tier == tier::FLEX || tier == tier::CORE || tier == tier::PRIME,
        StakingError::InvalidTier
    );

    // If user has existing stake, they must use the same tier or have zero balance
    if user_stake.is_active && user_stake.staked_amount > 0 {
        require!(user_stake.tier == tier, StakingError::CannotChangeTier);
    }

    let clock = Clock::get()?;

    // Calculate pending rewards before updating stake
    let pending = calculate_pending_rewards(
        &ctx.accounts.user_stake,
        &ctx.accounts.stake_pool,
        clock.unix_timestamp,
    )?;

    // Transfer tokens from user to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.staking_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // Update user stake account
    let user_stake = &mut ctx.accounts.user_stake;
    let stake_pool = &mut ctx.accounts.stake_pool;

    // If first time staking, initialize user stake
    if !user_stake.is_active {
        user_stake.owner = ctx.accounts.user.key();
        user_stake.stake_pool = stake_pool.key();
        user_stake.tier = tier;
        user_stake.stake_start_time = clock.unix_timestamp;
        user_stake.last_claim_time = clock.unix_timestamp;
        user_stake.total_rewards_claimed = 0;
        user_stake.is_active = true;
        user_stake.bump = ctx.bumps.user_stake;
        stake_pool.staker_count = stake_pool.staker_count.saturating_add(1);
    } else {
        // Store pending rewards before adding new stake
        user_stake.pending_rewards = user_stake
            .pending_rewards
            .checked_add(pending)
            .ok_or(StakingError::MathOverflow)?;
        user_stake.last_claim_time = clock.unix_timestamp;
    }

    // Update staked amount
    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_add(amount)
        .ok_or(StakingError::MathOverflow)?;

    // Update pool totals
    stake_pool.total_staked = stake_pool
        .total_staked
        .checked_add(amount)
        .ok_or(StakingError::MathOverflow)?;
    stake_pool.last_updated = clock.unix_timestamp;

    msg!("Staked {} tokens in tier {}", amount, tier);
    msg!("Total staked by user: {}", user_stake.staked_amount);

    Ok(())
}

/// Calculate pending rewards for a user stake.
///
/// Uses linear reward accrual: rewards = staked_amount * apy * time_elapsed / year
///
/// # Arguments
/// * `user_stake` - The user's stake account
/// * `stake_pool` - The stake pool
/// * `current_time` - Current Unix timestamp
///
/// # Returns
/// Calculated pending rewards (not including already pending rewards)
pub fn calculate_pending_rewards(
    user_stake: &UserStake,
    stake_pool: &StakePool,
    current_time: i64,
) -> Result<u64> {
    if !user_stake.is_active || user_stake.staked_amount == 0 {
        return Ok(0);
    }

    // Calculate time elapsed since last claim
    let time_elapsed = current_time
        .saturating_sub(user_stake.last_claim_time)
        .max(0) as u64;

    if time_elapsed == 0 {
        return Ok(0);
    }

    // Get APY for this tier
    let apy = stake_pool.get_apy_for_tier(user_stake.tier) as u128;

    // Calculate rewards with precision:
    // rewards = staked_amount * (apy / 10000) * (time_elapsed / seconds_per_year)
    // Rearranged for precision:
    // rewards = staked_amount * apy * time_elapsed / (10000 * seconds_per_year)
    let staked = user_stake.staked_amount as u128;
    let time = time_elapsed as u128;
    let year_seconds = SECONDS_PER_YEAR as u128;
    let basis_points = BASIS_POINTS_DENOMINATOR as u128;

    let rewards = staked
        .checked_mul(apy)
        .ok_or(StakingError::MathOverflow)?
        .checked_mul(time)
        .ok_or(StakingError::MathOverflow)?
        .checked_div(basis_points.checked_mul(year_seconds).ok_or(StakingError::MathOverflow)?)
        .ok_or(StakingError::MathOverflow)?;

    // Safe conversion back to u64
    let rewards_u64 = u64::try_from(rewards).map_err(|_| StakingError::MathOverflow)?;

    Ok(rewards_u64)
}
