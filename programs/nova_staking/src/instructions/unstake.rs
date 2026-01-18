/// Unstake instruction handler.
///
/// Handles withdrawing staked tokens from the pool with security validations.
///
/// ## Security Guarantees
/// - Lock period enforcement for Core/Prime tiers
/// - Owner validation prevents unauthorized unstaking
/// - Vault validation ensures tokens come from correct PDA

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::StakingError;
use crate::instructions::stake::calculate_pending_rewards;
use crate::state::{StakePool, UserStake};

/// Accounts required for unstaking.
///
/// ## Security Notes
/// - User must be signer AND match user_stake.owner
/// - All vault/mint validations enforced
#[derive(Accounts)]
pub struct Unstake<'info> {
    /// The user unstaking tokens.
    /// SECURITY: Must be signer and match stake owner.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The stake pool.
    /// SECURITY: PDA + has_one validations.
    #[account(
        mut,
        seeds = [STAKE_POOL_SEED, stake_pool.staking_mint.as_ref()],
        bump = stake_pool.bump,
        has_one = staking_vault @ StakingError::VaultMismatch,
        has_one = staking_mint @ StakingError::MintMismatch
    )]
    pub stake_pool: Account<'info, StakePool>,

    /// User's stake account.
    /// SECURITY: PDA + owner validation + pool validation.
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

    /// User's token account for receiving unstaked tokens.
    /// SECURITY: Mint and owner validation.
    #[account(
        mut,
        constraint = user_token_account.mint == staking_mint.key() @ StakingError::MintMismatch,
        constraint = user_token_account.owner == user.key() @ StakingError::UnauthorizedStakeAccess
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Pool's staking vault.
    /// SECURITY: Must match pool's stored vault + owner validation.
    #[account(
        mut,
        constraint = staking_vault.key() == stake_pool.staking_vault @ StakingError::VaultMismatch,
        constraint = staking_vault.owner == stake_pool.key() @ StakingError::InvalidVaultOwner,
        constraint = staking_vault.mint == staking_mint.key() @ StakingError::InvalidTokenAccountMint
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    /// Token program.
    pub token_program: Program<'info, Token>,
}

/// Unstake tokens from the pool.
///
/// # Security
/// - Enforces lock periods for Core (90 days) and Prime (180 days) tiers
/// - Validates signer is stake owner
/// - Uses checked math for all calculations
/// - PDA signer for vault transfer
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

    // === INPUT VALIDATION ===
    
    // Validate amount is non-zero
    require!(amount > 0, StakingError::ZeroAmount);

    // Validate user has active stake
    require!(user_stake.is_active, StakingError::NoActiveStake);

    // Validate sufficient balance
    require!(
        user_stake.staked_amount >= amount,
        StakingError::InsufficientStakedBalance
    );

    // === LOCK PERIOD ENFORCEMENT ===
    
    // Validate timestamp
    require!(clock.unix_timestamp > 0, StakingError::InvalidTimestamp);
    
    // Check lock period for Core and Prime tiers
    // Flex tier (tier 0) has no lock period
    require!(
        user_stake.is_lock_ended(clock.unix_timestamp, 0),
        StakingError::LockPeriodNotEnded
    );

    // === CALCULATE PENDING REWARDS ===
    
    let pending = calculate_pending_rewards(user_stake, stake_pool, clock.unix_timestamp)?;

    // === PDA SIGNER TRANSFER ===
    
    // Create PDA signer seeds for vault transfer
    let staking_mint_key = stake_pool.staking_mint;
    let seeds = &[
        STAKE_POOL_SEED,
        staking_mint_key.as_ref(),
        &[stake_pool.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Transfer tokens from vault to user
    let cpi_accounts = Transfer {
        from: ctx.accounts.staking_vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.stake_pool.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, amount)?;

    // === STATE UPDATE ===
    
    let user_stake = &mut ctx.accounts.user_stake;
    let stake_pool = &mut ctx.accounts.stake_pool;

    // Store pending rewards (checked add)
    user_stake.pending_rewards = user_stake
        .pending_rewards
        .checked_add(pending)
        .ok_or(StakingError::MathOverflow)?;
    user_stake.last_claim_time = clock.unix_timestamp;

    // Update staked amount (checked sub)
    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_sub(amount)
        .ok_or(StakingError::MathUnderflow)?;

    // If fully unstaked, mark as inactive and decrement staker count
    if user_stake.staked_amount == 0 {
        user_stake.is_active = false;
        stake_pool.staker_count = stake_pool.staker_count
            .checked_sub(1)
            .ok_or(StakingError::MathUnderflow)?;
    }

    // Update pool totals (checked sub)
    stake_pool.total_staked = stake_pool
        .total_staked
        .checked_sub(amount)
        .ok_or(StakingError::MathUnderflow)?;
    stake_pool.last_updated = clock.unix_timestamp;

    msg!("Unstaked {} tokens", amount);
    msg!("Remaining staked: {}", user_stake.staked_amount);
    msg!("Pending rewards: {}", user_stake.pending_rewards);

    Ok(())
}
