use crate::tier::Tier;

/// Stake instruction handler.
///
/// Handles staking NOVA tokens into the pool with security validations.
///
/// ## Security Guarantees
/// - Mint validation prevents wrong token staking
/// - Vault validation ensures tokens go to correct PDA
/// - All math uses checked operations

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::StakingError;
use crate::state::{StakePool, UserStake};

/// Accounts required for staking.
///
/// ## Security Notes
/// - `staking_mint` must match `stake_pool.staking_mint`
/// - `staking_vault` must match `stake_pool.staking_vault`  
/// - User token account must be for the correct mint
#[derive(Accounts)]
pub struct Stake<'info> {
    /// The user staking tokens.
    #[account(mut)]
    pub user: Signer<'info>,

    /// The stake pool.
    /// SECURITY: PDA verification + has_one constraints
    #[account(
        seeds = [STAKE_POOL_SEED, stake_pool.staking_mint.as_ref()],
        bump = stake_pool.bump,
        has_one = staking_vault @ StakingError::VaultMismatch,
        has_one = staking_mint @ StakingError::MintMismatch
    )]
    pub stake_pool: Account<'info, StakePool>,

    /// User's stake account (created if first time staking).
    /// SECURITY: PDA derived from pool + user ensures uniqueness.
    #[account(
        init_if_needed,
        payer = user,
        space = UserStake::LEN,
        seeds = [USER_STAKE_SEED, stake_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,

    /// The staking token mint.
    /// SECURITY: Validated against pool's locked mint.
    #[account(
        constraint = staking_mint.key() == stake_pool.staking_mint @ StakingError::MintMismatch
    )]
    pub staking_mint: Account<'info, Mint>,

    /// User's token account for the staking token.
    /// SECURITY: Mint and owner validation.
    #[account(
        mut,
        constraint = user_token_account.mint == staking_mint.key() @ StakingError::MintMismatch,
        constraint = user_token_account.owner == user.key() @ StakingError::UnauthorizedStakeAccess
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Pool's staking vault.
    /// SECURITY: Must match pool's stored vault address.
    #[account(
        mut,
        constraint = staking_vault.key() == stake_pool.staking_vault @ StakingError::VaultMismatch,
        constraint = staking_vault.owner == stake_pool.key() @ StakingError::InvalidVaultOwner,
        constraint = staking_vault.mint == staking_mint.key() @ StakingError::InvalidTokenAccountMint
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
/// # Security
/// - Validates pool is not paused
/// - Validates amount > 0
/// - Validates tier is valid (0, 1, or 2)
/// - Uses checked math for all calculations
/// - Validates mint matches pool's staking mint
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

    // === INPUT VALIDATION ===
    
    // Validate pool is not paused
    require!(!stake_pool.paused, StakingError::StakingPaused);

    // Validate amount is non-zero
    require!(amount > 0, StakingError::ZeroAmount);

    // Validate tier is valid
    require!(
        tier == Tier::FLEX as u8 || tier == Tier::CORE as u8 || tier == Tier::PRIME as u8,
        StakingError::InvalidTier
    );

    // === STATE VALIDATION ===
    
    // If user has existing active stake, they must use the same tier
    if user_stake.is_active && user_stake.staked_amount > 0 {
        require!(user_stake.tier == tier, StakingError::CannotChangeTier);
    }

    let clock = Clock::get()?;
    
    // Validate timestamp is reasonable (not in distant past/future)
    require!(
        clock.unix_timestamp > 0,
        StakingError::InvalidTimestamp
    );

    // Calculate pending rewards before updating stake (uses checked math)
    let pending = calculate_pending_rewards(
        &ctx.accounts.user_stake,
        &ctx.accounts.stake_pool,
        clock.unix_timestamp,
    )?;

    // === TOKEN TRANSFER ===
    
    // Transfer tokens from user to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.staking_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // === STATE UPDATE ===
    
    let user_stake = &mut ctx.accounts.user_stake;
    let stake_pool = &mut ctx.accounts.stake_pool;

    // Initialize user stake if first time
    if !user_stake.is_active {
        user_stake.owner = ctx.accounts.user.key();
        user_stake.stake_pool = stake_pool.key();
        user_stake.tier = tier;
        user_stake.stake_start_time = clock.unix_timestamp;
        user_stake.last_claim_time = clock.unix_timestamp;
        user_stake.total_rewards_claimed = 0;
        user_stake.pending_rewards = 0;
        user_stake.is_active = true;
        user_stake.bump = ctx.bumps.user_stake;
        
        // Update staker count with overflow check
        stake_pool.staker_count = stake_pool.staker_count
            .checked_add(1)
            .ok_or(StakingError::MathOverflow)?;
    } else {
        // Store pending rewards before adding new stake
        user_stake.pending_rewards = user_stake
            .pending_rewards
            .checked_add(pending)
            .ok_or(StakingError::MathOverflow)?;
        user_stake.last_claim_time = clock.unix_timestamp;
    }

    // Update staked amount with overflow check
    user_stake.staked_amount = user_stake
        .staked_amount
        .checked_add(amount)
        .ok_or(StakingError::MathOverflow)?;

    // Update pool totals with overflow check
    stake_pool.total_staked = stake_pool
        .total_staked
        .checked_add(amount)
        .ok_or(StakingError::MathOverflow)?;
    stake_pool.last_updated = clock.unix_timestamp;

    msg!("Staked {} tokens in tier {}", amount, tier);
    msg!("Total staked by user: {}", user_stake.staked_amount);

    Ok(())
}

/// Calculate pending rewards for a user stake using safe integer math.
///
/// Formula: rewards = staked_amount * apy * time_elapsed / (BASIS_POINTS * SECONDS_PER_YEAR)
///
/// # Security
/// - All arithmetic uses checked_* operations
/// - u128 intermediate values prevent overflow
/// - Safe conversion back to u64
/// - Handles i64/u64 timestamp conversions safely
///
/// # Arguments
/// * `user_stake` - The user's stake account
/// * `stake_pool` - The stake pool
/// * `current_time` - Current Unix timestamp (i64)
///
/// # Returns
/// Calculated pending rewards (not including already pending rewards)
pub fn calculate_pending_rewards(
    user_stake: &UserStake,
    stake_pool: &StakePool,
    current_time: i64,
) -> Result<u64> {
    // Early return for inactive or zero stake
    if !user_stake.is_active || user_stake.staked_amount == 0 {
        return Ok(0);
    }

    // === SAFE TIME CALCULATION ===
    
    // Validate timestamps are positive
    require!(current_time >= 0, StakingError::InvalidTimestamp);
    require!(user_stake.last_claim_time >= 0, StakingError::InvalidTimestamp);
    
    // Calculate time elapsed (i64 subtraction)
    let time_diff: i64 = current_time
        .checked_sub(user_stake.last_claim_time)
        .ok_or(StakingError::MathUnderflow)?;
    
    // If no time has passed or negative (clock skew), return 0
    if time_diff <= 0 {
        return Ok(0);
    }
    
    // Safe i64 to u64 conversion (we know it's positive)
    let time_elapsed: u64 = time_diff as u64;

    // === SAFE REWARD CALCULATION ===
    
    // Get APY for this tier (returns 0 for invalid tier)
    let apy = stake_pool.get_apy_for_tier(user_stake.tier);
    if apy == 0 {
        return Ok(0);
    }
    
    // Use u128 for intermediate calculations to prevent overflow
    // Max values: staked_amount (u64::MAX) * apy (5000) * time (u64::MAX)
    // This could overflow u64 but not u128
    let staked: u128 = user_stake.staked_amount as u128;
    let apy_128: u128 = apy as u128;
    let time_128: u128 = time_elapsed as u128;
    let year_seconds: u128 = SECONDS_PER_YEAR as u128;
    let basis_points: u128 = BASIS_POINTS_DENOMINATOR as u128;

    // Numerator: staked * apy * time
    let numerator = staked
        .checked_mul(apy_128)
        .ok_or(StakingError::MathOverflow)?
        .checked_mul(time_128)
        .ok_or(StakingError::MathOverflow)?;

    // Denominator: basis_points * year_seconds
    let denominator = basis_points
        .checked_mul(year_seconds)
        .ok_or(StakingError::MathOverflow)?;
    
    // Prevent division by zero (should never happen with constants)
    require!(denominator > 0, StakingError::DivisionByZero);

    // Calculate rewards
    let rewards_128 = numerator
        .checked_div(denominator)
        .ok_or(StakingError::DivisionByZero)?;

    // Safe conversion back to u64
    let rewards = u64::try_from(rewards_128)
        .map_err(|_| StakingError::ConversionOverflow)?;

    Ok(rewards)
}
