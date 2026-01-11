//! Claim rewards instruction handler.
//!
//! Handles claiming accumulated rewards without unstaking.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::StakingError;
use crate::instructions::stake::calculate_pending_rewards;
use crate::state::{StakePool, UserStake};

/// Accounts required for claiming rewards.
#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    /// The user claiming rewards.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The stake pool.
    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.staking_mint.as_ref()],
        bump = stake_pool.bump,
        has_one = treasury_vault,
        has_one = staking_mint
    )]
    pub stake_pool: Account<'info, StakePool>,

    /// User's stake account.
    #[account(
        mut,
        seeds = [USER_STAKE_SEED, stake_pool.key().as_ref(), user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ StakingError::Unauthorized,
        constraint = user_stake.stake_pool == stake_pool.key()
    )]
    pub user_stake: Account<'info, UserStake>,

    /// The staking token mint.
    pub staking_mint: Account<'info, Mint>,

    /// User's token account for receiving rewards.
    #[account(
        mut,
        constraint = user_token_account.mint == staking_mint.key() @ StakingError::MintMismatch,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Pool's treasury vault holding rewards.
    #[account(
        mut,
        constraint = treasury_vault.key() == stake_pool.treasury_vault
    )]
    pub treasury_vault: Account<'info, TokenAccount>,

    /// Token program.
    pub token_program: Program<'info, Token>,
}

/// Claim accumulated rewards.
///
/// Allows users to claim rewards without unstaking their tokens.
/// Rewards are paid from the treasury vault.
///
/// # Arguments
/// * `ctx` - ClaimRewards accounts context
///
/// # Returns
/// Result indicating success or error
pub fn handler(ctx: Context<ClaimRewards>) -> Result<()> {
    let user_stake = &ctx.accounts.user_stake;
    let stake_pool = &ctx.accounts.stake_pool;
    let treasury_vault = &ctx.accounts.treasury_vault;
    let clock = Clock::get()?;

    // Calculate newly accrued rewards
    let newly_accrued = calculate_pending_rewards(user_stake, stake_pool, clock.unix_timestamp)?;

    // Total claimable = pending + newly accrued
    let total_claimable = user_stake
        .pending_rewards
        .checked_add(newly_accrued)
        .ok_or(StakingError::MathOverflow)?;

    // Validate there are rewards to claim
    require!(total_claimable > 0, StakingError::NoRewardsAvailable);

    // Check treasury has sufficient funds
    require!(
        treasury_vault.amount >= total_claimable,
        StakingError::InsufficientTreasuryFunds
    );

    // Check emission cap won't be exceeded
    let new_total_distributed = stake_pool
        .total_distributed
        .checked_add(total_claimable)
        .ok_or(StakingError::MathOverflow)?;
    require!(
        new_total_distributed <= stake_pool.emission_cap,
        StakingError::EmissionCapExceeded
    );

    // Transfer rewards from treasury to user
    let staking_mint_key = stake_pool.staking_mint;
    let seeds = &[
        STAKE_POOL_SEED,
        staking_mint_key.as_ref(),
        &[stake_pool.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.treasury_vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.stake_pool.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, total_claimable)?;

    // Update user stake account
    let user_stake = &mut ctx.accounts.user_stake;
    let stake_pool = &mut ctx.accounts.stake_pool;

    user_stake.pending_rewards = 0;
    user_stake.last_claim_time = clock.unix_timestamp;
    user_stake.total_rewards_claimed = user_stake
        .total_rewards_claimed
        .checked_add(total_claimable)
        .ok_or(StakingError::MathOverflow)?;

    // Update pool totals
    stake_pool.total_distributed = new_total_distributed;
    stake_pool.last_updated = clock.unix_timestamp;

    msg!("Claimed {} reward tokens", total_claimable);
    msg!("Total rewards claimed by user: {}", user_stake.total_rewards_claimed);
    msg!("Total distributed from pool: {}", stake_pool.total_distributed);

    Ok(())
}
