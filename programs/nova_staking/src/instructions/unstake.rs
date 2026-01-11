//! Unstake instruction handler.
//!
//! Handles withdrawing staked tokens from the pool.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::StakingError;
use crate::instructions::stake::calculate_pending_rewards;
use crate::state::{StakePool, UserStake};

/// Accounts required for unstaking.
#[derive(Accounts)]
pub struct Unstake<'info> {
    /// The user unstaking tokens.
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

    /// User's stake account.
    #[account(
        mut,
        seeds = [USER_STAKE_SEED, stake_pool.key().as_ref(), user.key().as_ref()],
        bump = user_stake.bump,
        has_one = owner @ StakingError::Unauthorized,
        constraint = user_stake.stake_pool == stake_pool.key()
    )]
    pub user_stake: Account<'info, UserStake>,

    /// Owner constraint for security.
    /// CHECK: Validated through user_stake.owner constraint
    pub owner: UncheckedAccount<'info>,

    /// The staking token mint.
    pub staking_mint: Account<'info, Mint>,

    /// User's token account for receiving unstaked tokens.
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

    /// Token program.
    pub token_program: Program<'info, Token>,
}

/// Unstake tokens from the pool.
///
/// Enforces lock periods for Core and Prime tiers.
/// Flex tier can unstake anytime.
///
/// # Arguments
/// * `ctx` - Unstake accounts context
/// * `amount` - Amount of tokens to unstake
///
/// # Returns
/// Result indicating success or error
pub fn handler(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    let user_stake = &ctx.accounts.user_stake;
    let stake_pool = &ctx.accounts.stake_pool;
    let clock = Clock::get()?;

    // Validate amount
    require!(amount > 0, StakingError::ZeroAmount);

    // Validate user has active stake
    require!(user_stake.is_active, StakingError::NoActiveStake);

    // Validate sufficient balance
    require!(
        user_stake.staked_amount >= amount,
        StakingError::InsufficientStakedBalance
    );

    // Check lock period for Core and Prime tiers
    require!(
        user_stake.is_lock_ended(clock.unix_timestamp),
        StakingError::LockPeriodNotEnded
    );

    // Calculate pending rewards before unstaking
    let pending = calculate_pending_rewards(user_stake, stake_pool, clock.unix_timestamp)?;

    // Transfer tokens from vault to user using PDA signer
    let staking_mint_key = stake_pool.staking_mint;
    let seeds = &[
        STAKE_POOL_SEED,
        staking_mint_key.as_ref(),
        &[stake_pool.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.staking_vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.stake_pool.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, amount)?;

    // Update user stake account
    let user_stake = &mut ctx.accounts.user_stake;
    let stake_pool = &mut ctx.accounts.stake_pool;

    // Store pending rewards
    user_stake.pending_rewards = user_stake
        .pending_rewards
        .checked_add(pending)
        .ok_or(StakingError::MathOverflow)?;
    user_stake.last_claim_time = clock.unix_timestamp;

    // Update staked amount
    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_sub(amount)
        .ok_or(StakingError::MathOverflow)?;

    // If fully unstaked, mark as inactive and update staker count
    if user_stake.staked_amount == 0 {
        user_stake.is_active = false;
        stake_pool.staker_count = stake_pool.staker_count.saturating_sub(1);
    }

    // Update pool totals
    stake_pool.total_staked = stake_pool
        .total_staked
        .checked_sub(amount)
        .ok_or(StakingError::MathOverflow)?;
    stake_pool.last_updated = clock.unix_timestamp;

    msg!("Unstaked {} tokens", amount);
    msg!("Remaining staked: {}", user_stake.staked_amount);
    msg!("Pending rewards: {}", user_stake.pending_rewards);

    Ok(())
}
