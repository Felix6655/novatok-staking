/// Fund treasury instruction handler.
///
/// Handles depositing reward tokens into the treasury.
///
/// ## Security Guarantees
/// - Treasury validation ensures correct PDA
/// - Mint validation prevents wrong token deposits
/// - Anyone can fund (no admin restriction)

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::StakingError;
use crate::state::StakePool;

/// Accounts required for funding the treasury.
///
/// ## Security Notes
/// - Treasury must match pool's treasury vault
/// - Treasury must be owned by stake pool PDA
/// - Funder token account must be for correct mint
#[derive(Accounts)]
pub struct FundTreasury<'info> {
    /// The funder (anyone can fund - no admin restriction).
    #[account(mut)]
    pub funder: Signer<'info>,

    /// The stake pool.
    /// SECURITY: PDA + has_one validations.
    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.staking_mint.as_ref()],
        bump = stake_pool.bump,
        has_one = treasury_vault @ StakingError::TreasuryMismatch,
        has_one = staking_mint @ StakingError::MintMismatch
    )]
    pub stake_pool: Account<'info, StakePool>,

    /// The staking token mint.
    /// SECURITY: Must match pool's locked mint.
    #[account(
        constraint = staking_mint.key() == stake_pool.staking_mint @ StakingError::MintMismatch
    )]
    pub staking_mint: Account<'info, Mint>,

    /// Funder's token account.
    /// SECURITY: Mint and owner validation.
    #[account(
        mut,
        constraint = funder_token_account.mint == staking_mint.key() @ StakingError::MintMismatch,
        constraint = funder_token_account.owner == funder.key() @ StakingError::UnauthorizedStakeAccess
    )]
    pub funder_token_account: Account<'info, TokenAccount>,

    /// Pool's treasury vault.
    /// SECURITY: Must match pool's stored treasury + owner validation.
    #[account(
        mut,
        constraint = treasury_vault.key() == stake_pool.treasury_vault @ StakingError::TreasuryMismatch,
        constraint = treasury_vault.owner == stake_pool.key() @ StakingError::InvalidTreasuryOwner,
        constraint = treasury_vault.mint == staking_mint.key() @ StakingError::InvalidTokenAccountMint
    )]
    pub treasury_vault: Account<'info, TokenAccount>,

    /// Token program.
    pub token_program: Program<'info, Token>,
}

/// Fund the treasury with reward tokens.
///
/// # Security
/// - Validates amount > 0
/// - Validates correct mint
/// - Validates treasury PDA ownership
/// - Anyone can fund (permissionless)
///
/// # Arguments
/// * `ctx` - FundTreasury accounts context
/// * `amount` - Amount of tokens to fund
///
/// # Returns
/// Result indicating success or error
pub fn handler(ctx: Context<FundTreasury>, amount: u64) -> Result<()> {
    // === INPUT VALIDATION ===
    
    // Validate amount is non-zero
    require!(amount > 0, StakingError::ZeroAmount);

    // === TOKEN TRANSFER ===
    
    // Transfer tokens to treasury
    let cpi_accounts = Transfer {
        from: ctx.accounts.funder_token_account.to_account_info(),
        to: ctx.accounts.treasury_vault.to_account_info(),
        authority: ctx.accounts.funder.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // === STATE UPDATE ===
    
    let stake_pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;
    stake_pool.last_updated = clock.unix_timestamp;

    // Reload treasury to get updated balance
    ctx.accounts.treasury_vault.reload()?;
    let treasury_balance = ctx.accounts.treasury_vault.amount;

    msg!("Treasury funded with {} tokens", amount);
    msg!("New treasury balance: {}", treasury_balance);
    msg!("Funder: {}", ctx.accounts.funder.key());

    Ok(())
}
