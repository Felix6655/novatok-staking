//! Fund treasury instruction handler.
//!
//! Handles depositing reward tokens into the treasury.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::StakingError;
use crate::state::StakePool;

/// Accounts required for funding the treasury.
#[derive(Accounts)]
pub struct FundTreasury<'info> {
    /// The funder (anyone can fund).
    #[account(mut)]
    pub funder: Signer<'info>,

    /// The stake pool.
    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.staking_mint.as_ref()],
        bump = stake_pool.bump,
        has_one = treasury_vault,
        has_one = staking_mint
    )]
    pub stake_pool: Account<'info, StakePool>,

    /// The staking token mint.
    pub staking_mint: Account<'info, Mint>,

    /// Funder's token account.
    #[account(
        mut,
        constraint = funder_token_account.mint == staking_mint.key() @ StakingError::MintMismatch,
        constraint = funder_token_account.owner == funder.key()
    )]
    pub funder_token_account: Account<'info, TokenAccount>,

    /// Pool's treasury vault.
    #[account(
        mut,
        constraint = treasury_vault.key() == stake_pool.treasury_vault
    )]
    pub treasury_vault: Account<'info, TokenAccount>,

    /// Token program.
    pub token_program: Program<'info, Token>,
}

/// Fund the treasury with reward tokens.
///
/// Anyone can fund the treasury. These tokens will be used to pay
/// staking rewards.
///
/// # Arguments
/// * `ctx` - FundTreasury accounts context
/// * `amount` - Amount of tokens to fund
///
/// # Returns
/// Result indicating success or error
pub fn handler(ctx: Context<FundTreasury>, amount: u64) -> Result<()> {
    // Validate amount
    require!(amount > 0, StakingError::ZeroAmount);

    // Transfer tokens to treasury
    let cpi_accounts = Transfer {
        from: ctx.accounts.funder_token_account.to_account_info(),
        to: ctx.accounts.treasury_vault.to_account_info(),
        authority: ctx.accounts.funder.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // Update pool timestamp
    let stake_pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;
    stake_pool.last_updated = clock.unix_timestamp;

    // Get updated treasury balance
    ctx.accounts.treasury_vault.reload()?;
    let treasury_balance = ctx.accounts.treasury_vault.amount;

    msg!("Treasury funded with {} tokens", amount);
    msg!("New treasury balance: {}", treasury_balance);

    Ok(())
}
