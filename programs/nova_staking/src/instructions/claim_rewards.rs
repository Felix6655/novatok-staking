/// Claim rewards instruction handler.
///
/// Handles claiming accumulated rewards without unstaking.
///
/// ## Security Guarantees
/// - Owner validation ensures only stake owner can claim
/// - Treasury validation prevents fund theft
/// - Emission cap enforcement prevents unlimited minting

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::StakingError;
use crate::instructions::stake::calculate_pending_rewards;
use crate::state::{StakePool, UserStake};

/// Accounts required for claiming rewards.
///
/// ## Security Notes
/// - User must be signer AND match user_stake.owner
/// - Treasury must match pool's treasury vault
/// - Emission cap checked before transfer
#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    /// The user claiming rewards.
    /// SECURITY: Must be signer and match stake owner.
    #[account(mut)]
    pub user: Signer<'info>,

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

    /// User's stake account.
    /// SECURITY: PDA + owner + pool validation.
    #[account(
        mut,
        seeds = [USER_STAKE_SEED, stake_pool.key().as_ref(), user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ StakingError::InvalidStakeOwner,
        constraint = user_stake.stake_pool == stake_pool.key() @ StakingError::StakePoolMismatch
    )]
    pub user_stake: Account<'info, UserStake>,

    /// The staking token mint.
    /// SECURITY: Must match pool's locked mint.
    #[account(
        constraint = staking_mint.key() == stake_pool.staking_mint @ StakingError::MintMismatch
    )]
    pub staking_mint: Account<'info, Mint>,

    /// User's token account for receiving rewards.
    /// SECURITY: Mint and owner validation.
    #[account(
        mut,
        constraint = user_token_account.mint == staking_mint.key() @ StakingError::MintMismatch,
        constraint = user_token_account.owner == user.key() @ StakingError::UnauthorizedStakeAccess
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Pool's treasury vault holding rewards.
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

/// Claim accumulated rewards.
///
/// # Security
/// - Validates signer is stake owner
/// - Checks treasury has sufficient funds
/// - Enforces emission cap
/// - Uses checked math throughout
/// - PDA signer for treasury transfer
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

    // === TIMESTAMP VALIDATION ===
    require!(clock.unix_timestamp > 0, StakingError::InvalidTimestamp);

    // === CALCULATE REWARDS ===
    
    // Calculate newly accrued rewards (uses checked math internally)
    let newly_accrued = calculate_pending_rewards(user_stake, stake_pool, clock.unix_timestamp)?;

    // Total claimable = stored pending + newly accrued
    let total_claimable = user_stake
        .pending_rewards
        .checked_add(newly_accrued)
        .ok_or(StakingError::MathOverflow)?;

    // === CLAIM VALIDATION ===
    
    // Validate there are rewards to claim
    require!(total_claimable > 0, StakingError::NoRewardsAvailable);

    // Check treasury has sufficient funds
    require!(
        treasury_vault.amount >= total_claimable,
        StakingError::InsufficientTreasuryFunds
    );

    // === EMISSION CAP ENFORCEMENT ===
    
    // Calculate new total distributed
    let new_total_distributed = stake_pool
        .total_distributed
        .checked_add(total_claimable)
        .ok_or(StakingError::MathOverflow)?;
    
    // Enforce emission cap
    require!(
        new_total_distributed <= stake_pool.emission_cap,
        StakingError::EmissionCapExceeded
    );

    // === PDA SIGNER TRANSFER ===
    
    // Create PDA signer seeds for treasury transfer
    let staking_mint_key = stake_pool.staking_mint;
    let seeds = &[
        STAKE_POOL_SEED,
        staking_mint_key.as_ref(),
        &[stake_pool.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Transfer rewards from treasury to user
    let cpi_accounts = Transfer {
        from: ctx.accounts.treasury_vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.stake_pool.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, total_claimable)?;

    // === STATE UPDATE ===
    
    let user_stake = &mut ctx.accounts.user_stake;
    let stake_pool = &mut ctx.accounts.stake_pool;

    // Reset pending rewards
    user_stake.pending_rewards = 0;
    user_stake.last_claim_time = clock.unix_timestamp;
    
    // Update total rewards claimed (checked add)
    user_stake.total_rewards_claimed = user_stake
        .total_rewards_claimed
        .checked_add(total_claimable)
        .ok_or(StakingError::MathOverflow)?;

    // Update pool distribution total
    stake_pool.total_distributed = new_total_distributed;
    stake_pool.last_updated = clock.unix_timestamp;

    msg!("Claimed {} reward tokens", total_claimable);
    msg!("Total rewards claimed by user: {}", user_stake.total_rewards_claimed);
    msg!("Total distributed from pool: {}", stake_pool.total_distributed);
    msg!("Remaining emission cap: {}", stake_pool.emission_cap.saturating_sub(stake_pool.total_distributed));

    Ok(())
}
